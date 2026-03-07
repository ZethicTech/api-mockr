import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { MemoryRouteRegistry } from '../registry/MemoryRouteRegistry';
import { Pipeline, IncomingRequest } from '../runtime/pipeline';
import { normalizePath } from '../matcher/normalize';
import { Logger } from '../util/logger';

export interface MockServerOptions {
  registry: MemoryRouteRegistry;
  pipeline: Pipeline;
  logger: Logger;
  cors: boolean;
}

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/**
 * The mock server: one catch-all route, no dynamic registration.
 * Registry swaps stay trivial and the router is never mutated at runtime.
 */
export function createMockServer(opts: MockServerOptions): Hono {
  const app = new Hono();

  if (opts.cors) {
    // Permissive by default: frontend development is the primary use case, and
    // a browser app on :5173 calling mocks on :4000 fails without this.
    app.use(
      '*',
      cors({
        origin: (origin) => origin ?? '*',
        allowMethods: ALLOWED_METHODS,
        allowHeaders: ['*'],
        credentials: true,
        maxAge: 86400,
      }),
    );
  }

  app.all('*', async (c) => {
    const started = Date.now();
    const method = c.req.method.toUpperCase();
    const path = normalizePath(new URL(c.req.url).pathname);

    const match = opts.registry.get(method, path);

    if (!match) {
      opts.logger.request(method, path, 404, Date.now() - started, '—');
      return c.json({ error: 'route not found' }, 404);
    }

    const request: IncomingRequest = {
      method,
      path,
      query: Object.fromEntries(new URL(c.req.url).searchParams),
      headers: Object.fromEntries(
        [...new Headers(c.req.raw.headers).entries()].map(([k, v]) => [k.toLowerCase(), v]),
      ),
      body: await readBody(c.req.raw),
    };

    let outcome;
    try {
      outcome = await opts.pipeline.execute(match, request);
    } catch (err) {
      opts.logger.error('internal error', err as Error);
      opts.logger.request(method, path, 500, Date.now() - started, 'internal');
      return c.json({ error: 'internal server error' }, 500);
    }

    opts.logger.request(method, path, outcome.status, Date.now() - started, outcome.via);
    if (outcome.error) opts.logger.error(`${outcome.via}: ${outcome.error.message}`, outcome.error);

    return buildResponse(outcome.status, outcome.headers, outcome.body, method === 'HEAD');
  });

  return app;
}

/** Parse JSON when the content type says so; fall back to text, then raw. */
async function readBody(req: Request): Promise<unknown> {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD') return undefined;

  const contentType = (req.headers.get('content-type') ?? '').toLowerCase();
  const raw = await req.text();
  if (raw.length === 0) return undefined;

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch {
      // Malformed JSON is handed to interceptors as text; they may be decrypting it.
      return raw;
    }
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw));
  }

  return raw;
}

function buildResponse(
  status: number,
  headers: Record<string, string>,
  body: unknown,
  headOnly: boolean,
): Response {
  const outHeaders = new Headers();
  for (const [k, v] of Object.entries(headers)) outHeaders.set(k, v);

  if (body === undefined || status === 204 || status === 304) {
    return new Response(null, { status, headers: outHeaders });
  }

  let payload: string;
  if (typeof body === 'string') {
    if (!outHeaders.has('content-type')) outHeaders.set('content-type', 'text/plain; charset=utf-8');
    payload = body;
  } else {
    if (!outHeaders.has('content-type')) outHeaders.set('content-type', 'application/json; charset=utf-8');
    payload = JSON.stringify(body);
  }

  // HEAD gets the headers of its GET twin, with the body discarded.
  return new Response(headOnly ? null : payload, { status, headers: outHeaders });
}
