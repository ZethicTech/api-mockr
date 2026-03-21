import type { MockRoute, Status, ValidationIssue } from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public issues: ValidationIssue[] = [],
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
    throw new ApiError(
      (payload as { error?: string }).error ?? `request failed (${res.status})`,
      res.status,
      (payload as { issues?: ValidationIssue[] }).issues ?? [],
    );
  }

  return payload as T;
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
};
