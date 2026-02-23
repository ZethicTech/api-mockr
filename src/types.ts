export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

export const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];

export interface RouteResponse {
  status?: number;
  delayMs?: number;
  headers?: Record<string, string>;
  body?: unknown;
  interceptors?: string[];
}

export interface MockRoute {
  id: string;
  method: HttpMethod;
  path: string;
  request?: {
    interceptors?: string[];
  };
  response?: RouteResponse;
  handler?: string;
}

export interface MockrConfig {
  routes: MockRoute[];
}

/** What a handler or interceptor sees. `response` is undefined during the request phase. */
export interface Ctx {
  request: {
    method: string;
    path: string;
    params: Record<string, string>;
    query: Record<string, string>;
    headers: Record<string, string>;
    body: unknown;
  };
  response?: {
    status: number;
    headers: Record<string, string>;
    body?: unknown;
  };
  route: {
    id: string;
    path: string;
  };
}

export interface HandlerResult {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export type RouteHandler = (ctx: Ctx) => Promise<HandlerResult | void> | HandlerResult | void;
export type Interceptor = (ctx: Ctx) => Promise<void> | void;

export interface RouteMatch {
  route: MockRoute;
  params: Record<string, string>;
}

export interface LoadError {
  scope: 'config' | 'handler' | 'interceptor';
  name?: string;
  message: string;
}

export interface RegistryStatus {
  ok: boolean;
  routeCount: number;
  loadedAt: string | null;
  errors: LoadError[];
}
