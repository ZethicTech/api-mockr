import { Interceptor, RouteHandler } from '../types';
import { JWT_ALGORITHMS, JwtAlgorithm, JwtError, signJwt, verifyJwt } from './jwt';

/** Built-in names are prefixed so they can never collide with a user's file. */
export const BUILTIN_PREFIX = '@';

export const isBuiltin = (name: string): boolean => name.startsWith(BUILTIN_PREFIX);

export class BuiltinConfigError extends Error {}

export interface BuiltinDefinition {
  name: string;
  summary: string;
  /** Reject bad configuration at validation time rather than per request. */
  validate?: (config: Record<string, unknown>) => string[];
}

function requireString(
  config: Record<string, unknown>,
  key: string,
  builtin: string,
): string {
  const value = config[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new BuiltinConfigError(
      `"${builtin}" needs a "${key}" string in the "interceptors" block of mockr.json`,
    );
  }
  return value;
}

function unauthorized(ctx: Parameters<Interceptor>[0], message: string): void {
  ctx.response = { status: 401, headers: {}, body: { error: message } };
}

// ── @jwt ────────────────────────────────────────────────────────────────────

function jwtInterceptor(config: Record<string, unknown>): Interceptor {
  const secret = requireString(config, 'secret', '@jwt');
  const header = ((config.header as string) ?? 'authorization').toLowerCase();
  const scheme = (config.scheme as string) ?? 'Bearer';
  const attachTo = (config.attachTo as string) ?? 'user';
  const algorithms = (config.algorithms as JwtAlgorithm[]) ?? ['HS256'];
  const optional = config.optional === true;

  return (ctx) => {
    const raw = ctx.request.headers[header];

    if (!raw) {
      if (optional) return;
      return unauthorized(ctx, `missing ${header} header`);
    }

    const prefix = scheme ? `${scheme} ` : '';
    if (prefix && !raw.startsWith(prefix)) {
      return unauthorized(ctx, `expected a ${scheme} token`);
    }

    try {
      const payload = verifyJwt(raw.slice(prefix.length), {
        secret,
        algorithms,
        issuer: config.issuer as string | undefined,
        audience: config.audience as string | undefined,
        clockTolerance: config.clockTolerance as number | undefined,
      });
      // Decoded claims are put where handlers can read them.
      (ctx.request as unknown as Record<string, unknown>)[attachTo] = payload;
    } catch (err) {
      if (err instanceof JwtError) return unauthorized(ctx, err.message);
      throw err;
    }
  };
}

// ── @apiKey ─────────────────────────────────────────────────────────────────

function apiKeyInterceptor(config: Record<string, unknown>): Interceptor {
  const keys = Array.isArray(config.keys)
    ? (config.keys as string[])
    : [requireString(config, 'key', '@apiKey')];

  const header = ((config.header as string) ?? 'x-api-key').toLowerCase();
  const query = config.query as string | undefined;

  return (ctx) => {
    const supplied = ctx.request.headers[header] ?? (query ? ctx.request.query[query] : undefined);

    if (!supplied) return unauthorized(ctx, `missing ${header}`);
    if (!keys.includes(supplied)) return unauthorized(ctx, 'invalid api key');
  };
}

// ── @jwt.sign ───────────────────────────────────────────────────────────────

/**
 * Issues a token, so a mock login endpoint can hand out something @jwt will
 * accept. Without it there is no way to exercise a protected route.
 */
function jwtSignHandler(config: Record<string, unknown>): RouteHandler {
  const secret = requireString(config, 'secret', '@jwt.sign');
  const algorithm = ((config.algorithm as JwtAlgorithm) ?? 'HS256') as JwtAlgorithm;
  const expiresInSeconds = (config.expiresInSeconds as number) ?? 3600;
  const claims = (config.claims as Record<string, unknown>) ?? {};

  return (ctx) => {
    const body = (ctx.request.body ?? {}) as Record<string, unknown>;
    const token = signJwt({ ...claims, ...body }, { secret, algorithm, expiresInSeconds });
    return { status: 200, body: { token, expiresIn: expiresInSeconds } };
  };
}

// ── registry ────────────────────────────────────────────────────────────────

const algorithmsAreValid = (config: Record<string, unknown>): string[] => {
  const algorithms = config.algorithms;
  if (algorithms === undefined) return [];
  if (!Array.isArray(algorithms)) return ['"algorithms" must be an array'];
  const unknown = algorithms.filter((a) => !JWT_ALGORITHMS.includes(a as JwtAlgorithm));
  return unknown.length > 0
    ? [`unsupported algorithm(s) ${unknown.join(', ')} — supported: ${JWT_ALGORITHMS.join(', ')}`]
    : [];
};

const needsSecret = (config: Record<string, unknown>): string[] =>
  typeof config.secret === 'string' && config.secret.length > 0 ? [] : ['needs a "secret"'];

export const BUILTIN_INTERCEPTORS: Record<
  string,
  BuiltinDefinition & { create: (config: Record<string, unknown>) => Interceptor }
> = {
  '@jwt': {
    name: '@jwt',
    summary: 'Verify a JWT and attach its claims to ctx.request.user',
    create: jwtInterceptor,
    validate: (config) => [...needsSecret(config), ...algorithmsAreValid(config)],
  },
  '@apiKey': {
    name: '@apiKey',
    summary: 'Require a matching API key header',
    create: apiKeyInterceptor,
    validate: (config) =>
      typeof config.key === 'string' || Array.isArray(config.keys) ? [] : ['needs a "key" or "keys"'],
  },
};

export const BUILTIN_HANDLERS: Record<
  string,
  BuiltinDefinition & { create: (config: Record<string, unknown>) => RouteHandler }
> = {
  '@jwt.sign': {
    name: '@jwt.sign',
    summary: 'Issue a JWT from the request body',
    create: jwtSignHandler,
    validate: needsSecret,
  },
};
