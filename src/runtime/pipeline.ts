import { Ctx, HandlerResult, MockRoute, RouteMatch } from '../types';
import { ModuleLoadError, readThrown } from '../errors';
import { HandlerLoader } from '../loaders/HandlerLoader';
import { InterceptorLoader } from '../loaders/InterceptorLoader';

export interface IncomingRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
}

export interface PipelineOutcome {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
  /** For the request log. */
  via: string;
  /** Only set for genuine faults — never for a deliberate err.status. */
  error?: Error;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Pipeline {
  constructor(
    private handlers: HandlerLoader,
    private interceptors: InterceptorLoader,
  ) {}

  async execute(match: RouteMatch, request: IncomingRequest): Promise<PipelineOutcome> {
    const { route, params } = match;

    const ctx: Ctx = {
      request: { ...request, params },
      route: { id: route.id, path: route.path },
    };

    // ── Request interceptors ────────────────────────────────────────────────
    for (const name of route.request?.interceptors ?? []) {
      try {
        const interceptor = this.interceptors.load(name);
        await interceptor(ctx);
      } catch (err) {
        return this.fromError(err, 400, `interceptor:${name}`, { interceptor: name });
      }
      // Short-circuit: an interceptor that sets ctx.response ends the request
      // phase. This is what makes auth simulation (401) expressible at all.
      if (ctx.response) break;
    }

    // ── Handler or static response ──────────────────────────────────────────
    let via: string;

    if (!ctx.response) {
      if (route.handler) {
        via = `handler:${route.handler}`;
        try {
          const handler = this.handlers.load(route.handler);
          const result = (await handler(ctx)) as HandlerResult | undefined | void;
          ctx.response = normalizeResult(result);
        } catch (err) {
          if (err instanceof ModuleLoadError) {
            return this.fromError(err.cause, 500, via, {
              error: 'handler failed to load',
              handler: route.handler,
            });
          }
          return this.fromError(err, 500, via, {
            error: 'handler execution failed',
            handler: route.handler,
          });
        }
      } else {
        via = 'static';
        ctx.response = staticResponse(route);
      }
    } else {
      via = 'short-circuit';
    }

    // ── Response interceptors ───────────────────────────────────────────────
    for (const name of route.response?.interceptors ?? []) {
      try {
        const interceptor = this.interceptors.load(name);
        await interceptor(ctx);
      } catch (err) {
        // The request was fine; this failure is server-side, so 500 not 400.
        return this.fromError(err, 500, `interceptor:${name}`, { interceptor: name });
      }
    }

    // ── Delay ───────────────────────────────────────────────────────────────
    const delayMs = route.response?.delayMs ?? 0;
    if (delayMs > 0) await sleep(delayMs);

    const response = ctx.response ?? { status: 200, headers: {} };
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
      via,
    };
  }

  /**
   * Build a response from a thrown value. User code can set `status` and `body`
   * on the error to control the output verbatim; otherwise we surface the real
   * message rather than a useless hardcoded string.
   */
  private fromError(
    err: unknown,
    defaultStatus: number,
    via: string,
    extra: Record<string, unknown>,
  ): PipelineOutcome {
    const shape = readThrown(err);
    // Node appends a "Require stack" to module errors; the first line is the
    // part worth returning, and repeating it in two fields helps nobody.
    const summary = shape.message.split('\n')[0];
    const body =
      shape.body !== undefined
        ? shape.body
        : {
            ...extra,
            error: extra.error ?? summary,
            // Only carry a separate message when `error` is a fixed label and
            // would otherwise hide what actually went wrong.
            ...(extra.error !== undefined ? { message: summary } : {}),
          };

    // User code that sets err.status is expressing an intended outcome (a 401,
    // a 400 rejection). That is not a fault, so it gets no stack trace — the
    // request log line already records it. Only surprises are worth a stack.
    const deliberate = shape.status !== undefined;

    return {
      status: shape.status ?? defaultStatus,
      headers: {},
      body,
      via,
      error: deliberate ? undefined : err instanceof Error ? err : new Error(shape.message),
    };
  }
}

function normalizeResult(result: HandlerResult | undefined | void): NonNullable<Ctx['response']> {
  if (!result || typeof result !== 'object') {
    // A handler that returns nothing produces 204.
    return { status: 204, headers: {} };
  }
  return {
    status: result.status ?? 200,
    headers: result.headers ?? {},
    body: result.body,
  };
}

function staticResponse(route: MockRoute): NonNullable<Ctx['response']> {
  const r = route.response;
  const hasBody = r !== undefined && r.body !== undefined;
  return {
    status: r?.status ?? (hasBody ? 200 : 204),
    headers: { ...(r?.headers ?? {}) },
    body: r?.body,
  };
}
