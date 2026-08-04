import { createRequire } from 'node:module';
import { ModuleLoadError } from '../errors';
import { ModuleConfigBlock } from '../types';
import { expandEnv } from '../util/env';
import { findModuleFile, moduleCandidates, resolveModuleBase } from '../util/paths';

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

  /**
   * Called when a module loads successfully.
   *
   * A failed load is not cached, so a module that failed only because its
   * dependency was missing starts working the moment the user installs it —
   * without touching a file. The registry listens here so its recorded error
   * clears too, instead of the UI warning about something already fixed.
   */
  onLoadSuccess?: (name: string) => void;

  /** Per-module settings from mockr.json, refreshed on every reload. */
  private configBlock: ModuleConfigBlock = {};

  constructor(
    protected baseDir: string,
    protected kind: 'handler' | 'interceptor',
  ) {}

  /**
   * Replace the settings block. Cached built-ins are dropped because they
   * capture their configuration when constructed.
   */
  setConfig(block: ModuleConfigBlock): void {
    this.configBlock = block;
    this.dropBuiltins();
  }

  /** The settings for one module, with ${VAR} references expanded. */
  configFor(name: string): Record<string, unknown> {
    return expandEnv(this.configBlock[name] ?? {});
  }

  /** Built-ins are provided by Mockr; subclasses map a name to one. */
  protected createBuiltin?(name: string, config: Record<string, unknown>): T;

  protected dropBuiltins(): void {
    for (const name of [...this.cache.keys()]) {
      if (name.startsWith('@')) this.cache.delete(name);
    }
  }

  /** Load (or return cached) module by name. Throws ModuleLoadError. */
  load(name: string): T {
    const cached = this.cache.get(name);
    if (cached) return cached;

    if (name.startsWith('@')) {
      if (!this.createBuiltin) throw new ModuleLoadError(this.kind, name, new Error('unknown built-in'));
      let builtin: T;
      try {
        builtin = this.createBuiltin(name, this.configFor(name));
      } catch (err) {
        throw new ModuleLoadError(this.kind, name, err as Error);
      }
      this.cache.set(name, builtin);
      this.onLoadSuccess?.(name);
      return builtin;
    }

    let resolved: string | null;
    try {
      resolved = findModuleFile(this.baseDir, name);
    } catch (err) {
      throw new ModuleLoadError(this.kind, name, err as Error);
    }

    if (!resolved) {
      const tried = moduleCandidates(this.baseDir, name).join(' or ');
      throw new ModuleLoadError(this.kind, name, new Error(`file not found: ${tried}`));
    }

    let exported: unknown;
    try {
      delete requireUser.cache[requireUser.resolve(resolved)];
      exported = requireUser(resolved);
    } catch (err) {
      throw new ModuleLoadError(this.kind, name, explainLoadFailure(err as Error, resolved));
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
    this.onLoadSuccess?.(name);
    return value;
  }

  /** Drop one module from the cache so the next load re-reads it from disk. */
  invalidate(name: string): void {
    this.cache.delete(name);
    try {
      for (const candidate of moduleCandidates(this.baseDir, name)) {
        delete requireUser.cache[candidate];
      }
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

  /** Where this module would live, for error messages. */
  protected basePath(name: string): string {
    return resolveModuleBase(this.baseDir, name);
  }
}

/**
 * A .js file in a project with "type": "module" is ESM, so a CommonJS module
 * body fails with a message that does not mention Mockr at all. Point at the
 * fix instead of passing Node's wording through untouched.
 */
function explainLoadFailure(err: Error, file: string): Error {
  const esm =
    /module is not defined in ES module scope|Cannot use import statement|require\(\) of ES Module/.test(
      err.message,
    );

  if (!esm) return err;

  const renamed = file.replace(/\.js$/, '.cjs');
  return new Error(
    `${err.message.split('\n')[0]} — this project is ESM. Rename it to ${renamed.split('/').pop()}, ` +
      `which Mockr loads the same way, or use module.exports in a .cjs file.`,
  );
}
