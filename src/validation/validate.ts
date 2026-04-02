import Ajv, { ErrorObject } from 'ajv';
import { MockRoute, MockrConfig } from '../types';
import { configSchema } from './schema';
import { normalizeMethod, normalizePath } from '../matcher/normalize';
import { ProjectPaths, findModuleFile, moduleCandidates } from '../util/paths';

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

  const { routes } = config as MockrConfig;
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
      checkModule(issues, at, 'handler', paths.handlersDir, route.handler!, opts.checkFiles);
    }
    for (const name of route.request?.interceptors ?? []) {
      checkModule(issues, at, 'request interceptor', paths.interceptorsDir, name, opts.checkFiles);
    }
    for (const name of route.response?.interceptors ?? []) {
      checkModule(issues, at, 'response interceptor', paths.interceptorsDir, name, opts.checkFiles);
    }
  });

  return { ok: issues.length === 0, issues };
}

function checkModule(
  issues: ValidationIssue[],
  at: string,
  label: string,
  baseDir: string,
  name: string,
  checkFiles: boolean | undefined,
): void {
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
