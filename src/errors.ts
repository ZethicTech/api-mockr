/**
 * Thrown by user code (or Mockr itself) to control the emitted response.
 * User code sets `status` / `body` on a plain Error; we read them duck-typed.
 */
export class MockrError extends Error {
  status?: number;
  body?: unknown;

  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = 'MockrError';
    this.status = status;
    this.body = body;
  }
}

export interface UserErrorShape {
  status?: number;
  body?: unknown;
  message: string;
  stack?: string;
}

/** Duck-type an unknown thrown value into something we can build a response from. */
export function readThrown(err: unknown): UserErrorShape {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    const status = typeof e.status === 'number' && e.status >= 100 && e.status <= 599 ? e.status : undefined;
    return {
      status,
      body: 'body' in e ? e.body : undefined,
      message: typeof e.message === 'string' ? e.message : String(err),
      stack: typeof e.stack === 'string' ? e.stack : undefined,
    };
  }
  return { message: String(err) };
}

/** A user module that failed to load. Re-thrown per request until the file is fixed. */
export class ModuleLoadError extends Error {
  constructor(
    public kind: 'handler' | 'interceptor',
    public moduleName: string,
    public cause: Error,
  ) {
    super(`${kind} "${moduleName}" failed to load: ${cause.message}`);
    this.name = 'ModuleLoadError';
  }
}
