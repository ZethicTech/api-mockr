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

/** Server settings, as written in mockr.json. All optional. */
export interface ServerConfig {
  port?: number;
  adminPort?: number;
  host?: string;
  cors?: boolean;
  quiet?: boolean;
}

export interface MockrConfig {
  server?: ServerConfig;
  routes: MockRoute[];
}

/** Every server setting, resolved to a concrete value. */
export interface ResolvedServerConfig {
  port: number;
  adminPort: number;
  host: string;
  cors: boolean;
  quiet: boolean;
}

export const SERVER_DEFAULTS: ResolvedServerConfig = {
  port: 4000,
  adminPort: 4100,
  host: '127.0.0.1',
  cors: true,
  quiet: false,
};

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
