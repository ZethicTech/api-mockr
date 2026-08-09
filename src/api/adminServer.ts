import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { MemoryRouteRegistry } from '../registry/MemoryRouteRegistry';
import { JsonFileStore, generateRouteId } from '../storage/JsonFileStore';
import { validateConfig } from '../validation/validate';
import { MockRoute, MockrConfig } from '../types';
import { MODULE_EXTENSIONS, ProjectPaths } from '../util/paths';
import { BUILTIN_HANDLERS, BUILTIN_INTERCEPTORS } from '../builtin';
import {
  InvalidModuleName,
  ModuleFileStore,
  ModuleKind,
  ModuleSyntaxError,
} from '../storage/ModuleFileStore';
import { Logger } from '../util/logger';

export interface AdminServerOptions {
  paths: ProjectPaths;
  store: JsonFileStore;
  registry: MemoryRouteRegistry;
  logger: Logger;
  mockPort: number;
  uiDir: string | null;
  reload: () => Promise<void>;
}

/** Admin API + UI. Separate port from the mock server so /api/* stays mockable. */
export function createAdminServer(opts: AdminServerOptions): Hono {
  const app = new Hono();
  const { store, registry, paths } = opts;

  // The Vite dev server runs on another port during UI development.
  app.use('/api/*', cors({ origin: (o) => o ?? '*', allowMethods: ['GET', 'POST', 'PUT', 'DELETE'] }));

  // ── Status ────────────────────────────────────────────────────────────────
  app.get('/api/status', (c) => {
    const status = registry.status();
    return c.json({ ...status, mockPort: opts.mockPort, dir: paths.dir });
  });

  // ── Discovery ─────────────────────────────────────────────────────────────
  app.get('/api/handlers', (c) =>
    c.json({ handlers: listModules(paths.handlersDir), builtins: describe(BUILTIN_HANDLERS) }),
  );
  app.get('/api/interceptors', (c) =>
    c.json({ interceptors: listModules(paths.interceptorsDir), builtins: describe(BUILTIN_INTERCEPTORS) }),
  );

  // ── Module sources ────────────────────────────────────────────────────────
  // Handlers and interceptors are editable from the UI. Any dependency they
  // require must be installed in the user's own project.
  const stores: Record<ModuleKind, ModuleFileStore> = {
    handlers: new ModuleFileStore(paths.dir, paths.handlersDir),
    interceptors: new ModuleFileStore(paths.dir, paths.interceptorsDir),
  };

  const storeFor = (kind: string): ModuleFileStore | null =>
    kind === 'handlers' || kind === 'interceptors' ? stores[kind] : null;

  app.get('/api/:kind{handlers|interceptors}/:name', async (c) => {
    const store = storeFor(c.req.param('kind'))!;
    return withModuleErrors(c, async () => {
      const found = await store.read(c.req.param('name'));
      return found ? c.json(found) : c.json({ error: 'module not found' }, 404);
    });
  });

  app.put('/api/:kind{handlers|interceptors}/:name', async (c) => {
    const store = storeFor(c.req.param('kind'))!;
    const input = (await safeJson(c)) as { source?: unknown } | undefined;

    if (!input || typeof input.source !== 'string') {
      return c.json({ error: 'expected a JSON body with a "source" string' }, 400);
    }

    return withModuleErrors(c, async () => {
      const written = await store.write(c.req.param('name'), input.source as string);
      await opts.reload();
      return c.json(written);
    });
  });

  app.delete('/api/:kind{handlers|interceptors}/:name', async (c) => {
    const store = storeFor(c.req.param('kind'))!;
    return withModuleErrors(c, async () => {
      const removed = await store.remove(c.req.param('name'));
      if (!removed) return c.json({ error: 'module not found' }, 404);
      await opts.reload();
      return c.body(null, 204);
    });
  });

  // ── Routes ────────────────────────────────────────────────────────────────
  app.get('/api/routes', async (c) => {
    const routes = await readRoutes(store, registry);
    return c.json({ routes });
  });

  app.get('/api/routes/:id', async (c) => {
    const routes = await readRoutes(store, registry);
    const route = routes.find((r) => r.id === c.req.param('id'));
    if (!route) return c.json({ error: 'route not found' }, 404);
    return c.json(route);
  });

  app.post('/api/routes', async (c) => {
    const input = await safeJson(c);
    if (input === undefined) return c.json({ error: 'invalid JSON body' }, 400);

    const routes = await readRoutes(store, registry);
    const taken = new Set(routes.map((r) => r.id));
    let id = generateRouteId();
    while (taken.has(id)) id = generateRouteId();

    const route = { ...(input as MockRoute), id };
    const next = [...routes, route];

    const invalid = await reject(next, paths, store);
    if (invalid) return c.json(invalid, 422);

    await persist(opts, next);
    return c.json(route, 201);
  });

  app.put('/api/routes/:id', async (c) => {
    const id = c.req.param('id');
    const input = await safeJson(c);
    if (input === undefined) return c.json({ error: 'invalid JSON body' }, 400);

    const routes = await readRoutes(store, registry);
    const index = routes.findIndex((r) => r.id === id);
    if (index === -1) return c.json({ error: 'route not found' }, 404);

    // id is server-owned: a client cannot reassign it.
    const route = { ...(input as MockRoute), id };
    const next = [...routes];
    next[index] = route;

    const invalid = await reject(next, paths, store);
    if (invalid) return c.json(invalid, 422);

    await persist(opts, next);
    return c.json(route);
  });

  app.delete('/api/routes/:id', async (c) => {
    const id = c.req.param('id');
    const routes = await readRoutes(store, registry);
    const next = routes.filter((r) => r.id !== id);
    if (next.length === routes.length) return c.json({ error: 'route not found' }, 404);

    await persist(opts, next);
    return c.body(null, 204);
  });

  // ── UI ────────────────────────────────────────────────────────────────────
  if (opts.uiDir && fs.existsSync(opts.uiDir)) {
    const root = path.relative(process.cwd(), opts.uiDir) || '.';
    app.use('/*', serveStatic({ root }));
    app.get('*', serveStatic({ path: path.join(root, 'index.html') }));
  } else {
    app.get('/', (c) =>
      c.text('Mockr admin API is running, but the UI bundle was not found. Run: npm run build:ui'),
    );
  }

  return app;
}

/** Map the store's typed failures onto status codes. */
async function withModuleErrors(
  c: { json: (body: unknown, status: 400 | 422) => Response },
  run: () => Promise<Response>,
): Promise<Response> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof InvalidModuleName) return c.json({ error: err.message }, 400);
    if (err instanceof ModuleSyntaxError) {
      return c.json({ error: 'the code has a syntax error', message: err.message }, 422);
    }
    throw err;
  }
}

async function readRoutes(store: JsonFileStore, registry: MemoryRouteRegistry): Promise<MockRoute[]> {
  try {
    return await store.getRoutes();
  } catch {
    // mockr.json is unparseable right now; fall back to the last good state.
    return registry.routes();
  }
}

async function safeJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

/**
 * Validate before persisting. A rejected write never touches the file.
 *
 * The existing document is validated with the new routes, so a route using a
 * built-in is checked against the settings actually in the file.
 */
async function reject(
  routes: MockRoute[],
  paths: ProjectPaths,
  store: JsonFileStore,
): Promise<{ error: string; issues: unknown[] } | null> {
  let document: MockrConfig = { routes };
  try {
    document = { ...(await store.read()).config, routes };
  } catch {
    // Unreadable file: validate what we can rather than refusing the write.
  }

  const result = validateConfig(document, paths, { checkFiles: true });
  if (result.ok) return null;
  return { error: 'validation failed', issues: result.issues };
}

async function persist(opts: AdminServerOptions, routes: MockRoute[]): Promise<void> {
  await opts.store.saveRoutes(routes);
  await opts.reload();
}

/** Built-ins the UI can offer alongside the user's own files. */
function describe(
  builtins: Record<string, { name: string; summary: string }>,
): Array<{ name: string; summary: string }> {
  return Object.values(builtins).map(({ name, summary }) => ({ name, summary }));
}

function listModules(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];

  const names = new Set<string>();
  for (const file of fs.readdirSync(dir)) {
    if (file.startsWith('.')) continue;
    const ext = MODULE_EXTENSIONS.find((e) => file.endsWith(e));
    if (ext) names.add(file.slice(0, -ext.length));
  }

  return [...names].sort();
}
