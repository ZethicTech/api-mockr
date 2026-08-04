/**
 * Expand ${VAR} references in configuration strings.
 *
 * mockr.json is committed with the project, so a secret written there is a
 * secret in the repository. This lets the file name the variable instead:
 *
 *   { "secret": "${MOCK_JWT_SECRET}" }
 *
 * An unset variable expands to an empty string, which then fails the
 * built-in's own validation with a message naming what is missing.
 */
export function expandEnv<T>(value: T, env: NodeJS.ProcessEnv = process.env): T {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => env[name] ?? '') as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => expandEnv(item, env)) as T;
  }

  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = expandEnv(item, env);
    return out as T;
  }

  return value;
}
