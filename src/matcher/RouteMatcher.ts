import { MockRoute, RouteMatch } from '../types';
import { normalizeMethod, normalizePath, splitSegments } from './normalize';

interface CompiledRoute {
  route: MockRoute;
  segments: string[];
  /** Number of literal (non-param) segments — used for precedence. */
  staticScore: number;
}

/**
 * Segment-based matcher. Supports `:param` only — no regex, no wildcards.
 * Static segments beat parameters: /users/me wins over /users/:id.
 */
export class RouteMatcher {
  private byMethod = new Map<string, CompiledRoute[]>();

  constructor(routes: MockRoute[]) {
    for (const route of routes) {
      const segments = splitSegments(route.path);
      const compiled: CompiledRoute = {
        route,
        segments,
        staticScore: segments.filter((s) => !s.startsWith(':')).length,
      };
      const method = normalizeMethod(route.method);
      const list = this.byMethod.get(method);
      if (list) list.push(compiled);
      else this.byMethod.set(method, [compiled]);
    }
    // Most-static-first, so the first match found is the most specific one.
    for (const list of this.byMethod.values()) {
      list.sort((a, b) => b.staticScore - a.staticScore);
    }
  }

  match(method: string, path: string): RouteMatch | undefined {
    const m = normalizeMethod(method);
    const segments = splitSegments(normalizePath(path));

    const direct = this.matchIn(this.byMethod.get(m), segments);
    if (direct) return direct;

    // HEAD falls back to the matching GET route; the body is discarded downstream.
    if (m === 'HEAD') return this.matchIn(this.byMethod.get('GET'), segments);

    return undefined;
  }

  private matchIn(candidates: CompiledRoute[] | undefined, segments: string[]): RouteMatch | undefined {
    if (!candidates) return undefined;

    for (const candidate of candidates) {
      if (candidate.segments.length !== segments.length) continue;

      const params: Record<string, string> = {};
      let matched = true;

      for (let i = 0; i < segments.length; i++) {
        const pattern = candidate.segments[i];
        if (pattern.startsWith(':')) {
          params[pattern.slice(1)] = decodeURIComponent(segments[i]);
        } else if (pattern !== segments[i]) {
          matched = false;
          break;
        }
      }

      if (matched) return { route: candidate.route, params };
    }

    return undefined;
  }
}
