import type { MockRoute, Status, ValidationIssue } from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public issues: ValidationIssue[] = [],
    /** Extra context, such as the parser's message for a syntax error. */
    public detail: string | null = null,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json', ...init?.headers } : init?.headers,
  });

  if (res.status === 204) return undefined as T;

  const payload = await res.json().catch(() => ({}));

  if (!res.ok) {
    const body = payload as { error?: string; message?: string; issues?: ValidationIssue[] };
    throw new ApiError(
      body.error ?? `request failed (${res.status})`,
      res.status,
      body.issues ?? [],
      body.message ?? null,
    );
  }

  return payload as T;
}

export type ModuleKind = 'handlers' | 'interceptors';

export interface ModuleFile {
  name: string;
  file: string;
  ext: string;
  source: string;
}

export const api = {
  status: () => request<Status>('/api/status'),
  routes: () => request<{ routes: MockRoute[] }>('/api/routes').then((r) => r.routes),
  handlers: () => request<{ handlers: string[] }>('/api/handlers').then((r) => r.handlers),
  interceptors: () => request<{ interceptors: string[] }>('/api/interceptors').then((r) => r.interceptors),

  create: (route: Omit<MockRoute, 'id'>) =>
    request<MockRoute>('/api/routes', { method: 'POST', body: JSON.stringify(route) }),

  update: (id: string, route: Omit<MockRoute, 'id'>) =>
    request<MockRoute>(`/api/routes/${id}`, { method: 'PUT', body: JSON.stringify(route) }),

  remove: (id: string) => request<void>(`/api/routes/${id}`, { method: 'DELETE' }),

  readModule: (kind: ModuleKind, name: string) => request<ModuleFile>(`/api/${kind}/${name}`),

  writeModule: (kind: ModuleKind, name: string, source: string) =>
    request<ModuleFile>(`/api/${kind}/${name}`, { method: 'PUT', body: JSON.stringify({ source }) }),

  deleteModule: (kind: ModuleKind, name: string) =>
    request<void>(`/api/${kind}/${name}`, { method: 'DELETE' }),
};

export const HANDLER_TEMPLATE = `module.exports = async function (ctx) {
  // ctx.request has method, path, params, query, headers and body.
  // Return { status, headers, body } — all optional.

  return {
    status: 200,
    body: { ok: true },
  };
};
`;

export const INTERCEPTOR_TEMPLATE = `module.exports = async function (ctx) {
  // Mutate ctx. The return value is ignored.
  //
  // Request phase:  ctx.response is undefined.
  //                 Set it to end the request early, e.g. a 401.
  // Response phase: ctx.response is populated.
};
`;
