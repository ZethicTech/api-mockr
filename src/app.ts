import path from 'node:path';
import { serve, ServerType } from '@hono/node-server';
import { FSWatcher } from 'chokidar';
import { projectPaths, ProjectPaths } from './util/paths';
import { Logger } from './util/logger';
import { JsonFileStore } from './storage/JsonFileStore';
import { HandlerLoader } from './loaders/HandlerLoader';
import { InterceptorLoader } from './loaders/InterceptorLoader';
import { MemoryRouteRegistry } from './registry/MemoryRouteRegistry';
import { Pipeline } from './runtime/pipeline';
import { createMockServer } from './http/mockServer';
import { createAdminServer } from './api/adminServer';
import { createWatcher } from './watcher/watcher';
import { scaffold } from './scaffold';

export interface StartOptions {
  dir: string;
  port: number;
  adminPort: number;
  host: string;
  cors: boolean;
  quiet: boolean;
  watch?: boolean;
  uiDir?: string | null;
}

export interface RunningMockr {
  paths: ProjectPaths;
  registry: MemoryRouteRegistry;
  store: JsonFileStore;
  logger: Logger;
  mockPort: number;
  adminPort: number;
  close: () => Promise<void>;
}

export async function start(opts: StartOptions): Promise<RunningMockr> {
  const paths = projectPaths(opts.dir);
  const logger = new Logger({ quiet: opts.quiet });

  const store = new JsonFileStore(paths);
  if (!store.exists()) {
    const { created, esm } = scaffold(paths);
    logger.info(`Created a new Mockr project in ${paths.dir}`);
    for (const file of created) logger.info(`  + ${file}`);
    if (esm) {
      logger.info('');
      logger.info('  This project is ESM ("type": "module"), so handlers use .cjs');
    }
    logger.info('');
  }

  const handlers = new HandlerLoader(paths);
  const interceptors = new InterceptorLoader(paths);
  const registry = new MemoryRouteRegistry(paths, store, handlers, interceptors);
  const pipeline = new Pipeline(handlers, interceptors);

  await registry.load();
  reportStatus(registry, logger);

  const reload = async () => {
    await registry.reload();
    const status = registry.status();
    logger.reloaded(status.routeCount, status.errors.length);
    for (const err of status.errors) {
      logger.warn(`${err.scope}${err.name ? ` "${err.name}"` : ''}: ${err.message}`);
    }
  };

  const uiDir =
    opts.uiDir === undefined ? path.join(__dirname, 'ui') : opts.uiDir;

  const mockApp = createMockServer({ registry, pipeline, logger, cors: opts.cors });
  const adminApp = createAdminServer({
    paths,
    store,
    registry,
    logger,
    mockPort: opts.port,
    uiDir,
    reload,
  });

  const mockServer = await listen(mockApp, opts.port, opts.host);
  const adminServer = await listen(adminApp, opts.adminPort, opts.host);

  let watcher: FSWatcher | null = null;
  if (opts.watch !== false) {
    watcher = await createWatcher({ paths, store, logger, onReload: reload });
  }

  const mockPort = portOf(mockServer, opts.port);
  const adminPort = portOf(adminServer, opts.adminPort);

  return {
    paths,
    registry,
    store,
    logger,
    mockPort,
    adminPort,
    close: async () => {
      if (watcher) await watcher.close();
      await Promise.all([closeServer(mockServer), closeServer(adminServer)]);
    },
  };
}

function reportStatus(registry: MemoryRouteRegistry, logger: Logger): void {
  const status = registry.status();
  for (const err of status.errors) {
    logger.warn(`${err.scope}${err.name ? ` "${err.name}"` : ''}: ${err.message}`);
  }
}

function listen(app: { fetch: (req: Request) => Response | Promise<Response> }, port: number, hostname: string): Promise<ServerType> {
  return new Promise((resolve, reject) => {
    try {
      const server = serve({ fetch: app.fetch, port, hostname }, () => resolve(server));
      server.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

function portOf(server: ServerType, fallback: number): number {
  const address = server.address();
  return address && typeof address === 'object' ? address.port : fallback;
}

function closeServer(server: ServerType): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
