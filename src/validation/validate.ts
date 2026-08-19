import Ajv, { ErrorObject } from 'ajv';
import { MockRoute, MockrConfig } from '../types';
import { configSchema } from './schema';
import { normalizeMethod, normalizePath } from '../matcher/normalize';
import { ProjectPaths, findModuleFile, moduleCandidates } from '../util/paths';
import { BUILTIN_HANDLERS, BUILTIN_INTERCEPTORS, isBuiltin } from '../builtin';
import { expandEnv } from '../util/env';

const ajv = new Ajv({ allErrors: true, strict: false });
const validateConfigSchema = ajv.compile(configSchema);

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

function formatAjvError(e: ErrorObject): ValidationIssue {
  return {
    path: e.instancePath || '/',
    message: `${e.message ?? 'invalid'}${e.params && 'allowedValues' in e.params ? ` (${(e.params as any).allowedValues.join(', ')})` : ''}`,
  };
}

/**
 * Validate config shape plus the rules ajv can't express.
 * Every problem is collected so the UI can show them all at once.
 */
export function validateConfig(
  config: unknown,
  paths: ProjectPaths,
  opts: { checkFiles?: boolean } = {},
): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!validateConfigSchema(config)) {
    for (const e of validateConfigSchema.errors ?? []) issues.push(formatAjvError(e));
    return { ok: false, issues };
  }

  const { routes, server, interceptors: interceptorConfig, handlers: handlerConfig } = config as MockrConfig;

  if (server?.port !== undefined && server.port === server.adminPort) {
    issues.push({ path: '/server', message: '"port" and "adminPort" must differ' });
  }

  const seen = new Map<string, number>();

  routes.forEach((route, i) => {
    const at = `/routes/${i}`;
    const hasResponse = route.response !== undefined;
    const hasHandler = route.handler !== undefined;

    if (hasResponse && hasHandler) {
      issues.push({ path: at, message: 'a route cannot define both "response" and "handler"' });
    }
    if (!hasResponse && !hasHandler) {
      issues.push({ path: at, message: 'a route must define either "response" or "handler"' });
    }

    const key = `${normalizeMethod(route.method)} ${normalizePath(route.path)}`;
    const first = seen.get(key);
    if (first !== undefined) {
      issues.push({ path: at, message: `duplicate route "${key}" (already defined at /routes/${first})` });
    } else {
      seen.set(key, i);
    }

    for (const seg of normalizePath(route.path).split('/')) {
      if (seg === ':') issues.push({ path: at, message: 'path parameter is missing a name' });
      if (seg.includes('*')) issues.push({ path: at, message: 'wildcard routes are not supported' });
    }

    if (hasHandler) {
      checkModule(issues, at, 'handler', paths.handlersDir, route.handler!, opts.checkFiles, {
        builtins: BUILTIN_HANDLERS,
        config: handlerConfig,
        block: 'handlers',
      });
    }
    for (const name of route.request?.interceptors ?? []) {
      checkModule(issues, at, 'request interceptor', paths.interceptorsDir, name, opts.checkFiles, {
        builtins: BUILTIN_INTERCEPTORS,
        config: interceptorConfig,
        block: 'interceptors',
      });
    }
    for (const name of route.response?.interceptors ?? []) {
      checkModule(issues, at, 'response interceptor', paths.interceptorsDir, name, opts.checkFiles, {
        builtins: BUILTIN_INTERCEPTORS,
        config: interceptorConfig,
        block: 'interceptors',
      });
    }
  });

  return { ok: issues.length === 0, issues };
}

interface BuiltinLookup {
  builtins: Record<string, { validate?: (config: Record<string, unknown>) => string[] }>;
  config: Record<string, Record<string, unknown>> | undefined;
  /** Which top-level block holds these settings. */
  block: 'interceptors' | 'handlers';
}

function checkModule(
  issues: ValidationIssue[],
  at: string,
  label: string,
  baseDir: string,
  name: string,
  checkFiles: boolean | undefined,
  lookup: BuiltinLookup,
): void {
  // Built-ins are provided by Mockr; they have no file, but they do have
  // configuration, and a missing secret should surface here rather than as a
  // 500 on the first request that needs it.
  if (isBuiltin(name)) {
    const builtin = lookup.builtins[name];
    if (!builtin) {
      const available = Object.keys(lookup.builtins).join(', ');
      issues.push({ path: at, message: `unknown built-in ${label} "${name}" — available: ${available}` });
      return;
    }

    const settings = expandEnv(lookup.config?.[name] ?? {});
    for (const problem of builtin.validate?.(settings) ?? []) {
      issues.push({
        path: at,
        message: `${label} "${name}" ${problem} — set it under "${lookup.block}" in mockr.json`,
      });
    }
    return;
  }

  let found: string | null;
  try {
    found = findModuleFile(baseDir, name);
  } catch (err) {
    issues.push({ path: at, message: `${label} ${(err as Error).message}` });
    return;
  }
  if (checkFiles && !found) {
    const tried = moduleCandidates(baseDir, name).join(' or ');
    issues.push({ path: at, message: `${label} "${name}" not found (expected ${tried})` });
  }
}

export function issuesToMessage(issues: ValidationIssue[]): string {
  return issues.map((i) => `${i.path}: ${i.message}`).join('; ');
}

export function isMockRouteArray(value: unknown): value is MockRoute[] {
  return Array.isArray(value);
}
