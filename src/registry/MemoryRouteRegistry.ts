import { LoadError, MockRoute, RegistryStatus, RouteMatch } from '../types';
import { RouteMatcher } from '../matcher/RouteMatcher';
import { JsonFileStore } from '../storage/JsonFileStore';
import { HandlerLoader } from '../loaders/HandlerLoader';
import { InterceptorLoader } from '../loaders/InterceptorLoader';
import { validateConfig } from '../validation/validate';
import { ModuleLoadError } from '../errors';
import { ProjectPaths } from '../util/paths';

interface RegistryState {
  routes: MockRoute[];
  matcher: RouteMatcher;
  loadedAt: string;
}

/**
 * Holds the active routes in memory.
 *
 * Last-good semantics: if a reload fails for any reason, the previous valid
 * state keeps serving and the error is recorded in status(). Mockr never
 * crashes and never silently empties the route table because the user was
 * mid-keystroke in mockr.json.
 */
export class MemoryRouteRegistry {
  private state: RegistryState | null = null;
  private errors: LoadError[] = [];

  constructor(
    private paths: ProjectPaths,
    private store: JsonFileStore,
    private handlers: HandlerLoader,
    private interceptors: InterceptorLoader,
  ) {
    this.handlers.onLoadSuccess = (name) => this.clearError('handler', name);
    this.interceptors.onLoadSuccess = (name) => this.clearError('interceptor', name);
  }

  /** Drop a recorded failure once that module loads. */
  private clearError(scope: LoadError['scope'], name: string): void {
    if (this.errors.length === 0) return;
    this.errors = this.errors.filter((e) => !(e.scope === scope && e.name === name));
  }

  async load(): Promise<void> {
    await this.reload();
  }

  /** Never throws. Failures land in status().errors and the old state stands. */
  async reload(): Promise<void> {
    const errors: LoadError[] = [];
    let routes: MockRoute[];

    try {
      const { config } = await this.store.read();
      routes = config.routes;
    } catch (err) {
      errors.push({ scope: 'config', message: (err as Error).message });
      this.errors = errors;
      return;
    }

    const result = validateConfig({ routes }, this.paths, { checkFiles: true });
    if (!result.ok) {
      for (const issue of result.issues) {
        errors.push({ scope: 'config', message: `${issue.path}: ${issue.message}` });
      }
      this.errors = errors;
      return;
    }

    // Eager load: a syntax error in payment.js should surface the moment it is
    // saved, not as a mystery 500 an hour later. Load failures do not block the
    // swap — the route stays registered and 500s with the load error.
    this.handlers.invalidateAll();
    this.interceptors.invalidateAll();

    for (const route of routes) {
      if (route.handler) this.tryLoad(errors, () => this.handlers.load(route.handler!));
      for (const name of route.request?.interceptors ?? []) {
        this.tryLoad(errors, () => this.interceptors.load(name));
      }
      for (const name of route.response?.interceptors ?? []) {
        this.tryLoad(errors, () => this.interceptors.load(name));
      }
    }

    // Atomic swap: in-flight requests keep the state they started with.
    this.state = {
      routes,
      matcher: new RouteMatcher(routes),
      loadedAt: new Date().toISOString(),
    };
    this.errors = errors;
  }

  private tryLoad(errors: LoadError[], fn: () => unknown): void {
    try {
      fn();
    } catch (err) {
      if (err instanceof ModuleLoadError) {
        errors.push({ scope: err.kind, name: err.moduleName, message: err.cause.message });
      } else {
        errors.push({ scope: 'config', message: (err as Error).message });
      }
    }
  }

  get(method: string, path: string): RouteMatch | undefined {
    return this.state?.matcher.match(method, path);
  }

  routes(): MockRoute[] {
    return this.state?.routes ?? [];
  }

  status(): RegistryStatus {
    return {
      ok: this.errors.length === 0 && this.state !== null,
      routeCount: this.state?.routes.length ?? 0,
      loadedAt: this.state?.loadedAt ?? null,
      errors: this.errors,
    };
  }
}
