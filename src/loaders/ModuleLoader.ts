import fs from 'node:fs';
import { createRequire } from 'node:module';
import { ModuleLoadError } from '../errors';
import { resolveModulePath } from '../util/paths';

const requireUser = createRequire(__filename);

/**
 * Loads user CommonJS modules and invalidates them on change.
 *
 * CommonJS is deliberate: `delete require.cache[...]` is the only real cache
 * invalidation Node offers. ESM has none, and the `import()` cache-busting
 * workaround leaks every version of every module for the process lifetime.
 */
export abstract class ModuleLoader<T> {
  protected cache = new Map<string, T>();

  constructor(
    protected baseDir: string,
    protected kind: 'handler' | 'interceptor',
  ) {}

  /** Load (or return cached) module by name. Throws ModuleLoadError. */
  load(name: string): T {
    const cached = this.cache.get(name);
    if (cached) return cached;

    let resolved: string;
    try {
      resolved = resolveModulePath(this.baseDir, name);
    } catch (err) {
      throw new ModuleLoadError(this.kind, name, err as Error);
    }

    if (!fs.existsSync(resolved)) {
      throw new ModuleLoadError(this.kind, name, new Error(`file not found: ${resolved}`));
    }

    let exported: unknown;
    try {
      delete requireUser.cache[requireUser.resolve(resolved)];
      exported = requireUser(resolved);
    } catch (err) {
      throw new ModuleLoadError(this.kind, name, err as Error);
    }

    // Tolerate `export default` output from bundlers alongside plain CJS.
    const fn =
      typeof exported === 'function'
        ? exported
        : exported && typeof (exported as any).default === 'function'
          ? (exported as any).default
          : undefined;

    if (!fn) {
      throw new ModuleLoadError(
        this.kind,
        name,
        new Error(`must export a function via module.exports (got ${typeof exported})`),
      );
    }

    const value = fn as T;
    this.cache.set(name, value);
    return value;
  }

  /** Drop one module from the cache so the next load re-reads it from disk. */
  invalidate(name: string): void {
    this.cache.delete(name);
    try {
      const resolved = resolveModulePath(this.baseDir, name);
      delete requireUser.cache[requireUser.resolve(resolved)];
    } catch {
      // Unresolvable names were never cached by require in the first place.
    }
  }

  invalidateAll(): void {
    for (const name of [...this.cache.keys()]) this.invalidate(name);
    this.cache.clear();
  }

  has(name: string): boolean {
    return this.cache.has(name);
  }
}
