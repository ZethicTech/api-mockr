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
  request?: { interceptors?: string[] };
  response?: RouteResponse;
  handler?: string;
}

export interface LoadError {
  scope: 'config' | 'handler' | 'interceptor';
  name?: string;
  message: string;
}

export interface Status {
  ok: boolean;
  routeCount: number;
  loadedAt: string | null;
  errors: LoadError[];
  mockPort: number;
  dir: string;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export const isHandlerRoute = (route: Pick<MockRoute, 'handler'>): boolean => route.handler !== undefined;
