import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Builtin } from '../api';
import type { MockRoute, ValidationIssue } from '../types';
import { HTTP_METHODS } from '../types';
import { Button, Input, Label, Select, WarnIcon } from './primitives';
import { InterceptorPicker } from './InterceptorPicker';
import { JsonEditor, JsonError, parseJson } from './JsonEditor';

export interface Draft {
  method: string;
  path: string;
  mode: 'static' | 'handler';
  status: string;
  delayMs: string;
  headers: string;
  body: string;
  handler: string;
  requestInterceptors: string[];
  responseInterceptors: string[];
}

export function toDraft(route: MockRoute): Draft {
  return {
    method: route.method,
    path: route.path,
    mode: route.handler !== undefined ? 'handler' : 'static',
    status: String(route.response?.status ?? 200),
    delayMs: String(route.response?.delayMs ?? 0),
    headers: JSON.stringify(route.response?.headers ?? {}, null, 2),
    body: JSON.stringify(route.response?.body ?? {}, null, 2),
    handler: route.handler ?? '',
    requestInterceptors: route.request?.interceptors ?? [],
    responseInterceptors: route.response?.interceptors ?? [],
  };
}

export const emptyDraft = (): Draft => ({
  method: 'GET',
  path: '/',
  mode: 'static',
  status: '200',
  delayMs: '0',
  headers: '{}',
  body: '{\n  "ok": true\n}',
  handler: '',
  requestInterceptors: [],
  responseInterceptors: [],
});

/** Build the payload the API expects, or report why the draft is not valid. */
export function draftToRoute(draft: Draft): { route: Omit<MockRoute, 'id'> } | { error: string } {
  const path = draft.path.trim();
  if (!path.startsWith('/')) return { error: 'Path must start with "/"' };

  const base = {
    method: draft.method as MockRoute['method'],
    path,
    ...(draft.requestInterceptors.length > 0
      ? { request: { interceptors: draft.requestInterceptors } }
      : {}),
  };

  if (draft.mode === 'handler') {
    if (!draft.handler) return { error: 'Choose a handler, or switch to a static response' };
    // A handler route carries no response object — the two are exclusive.
    return { route: { ...base, handler: draft.handler } };
  }

  const status = Number(draft.status);
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    return { error: 'Status must be between 100 and 599' };
  }

  const delayMs = Number(draft.delayMs || 0);
  if (!Number.isInteger(delayMs) || delayMs < 0) return { error: 'Delay must be 0 or more' };

  const headers = parseJson(draft.headers || '{}');
  if ('error' in headers) return { error: `Headers: ${headers.error.message}` };

  const body = parseJson(draft.body || 'null');
  if ('error' in body) return { error: `Body: ${body.error.message}` };

  return {
    route: {
      ...base,
      response: {
        status,
        ...(delayMs > 0 ? { delayMs } : {}),
        ...(Object.keys(headers.value as object).length > 0
          ? { headers: headers.value as Record<string, string> }
          : {}),
        ...(body.value === null ? {} : { body: body.value }),
        ...(draft.responseInterceptors.length > 0
          ? { interceptors: draft.responseInterceptors }
          : {}),
      },
    },
  };
}

export type EditModule = (kind: 'handlers' | 'interceptors', name: string) => void;

interface Props {
  draft: Draft;
  isNew: boolean;
  saving: boolean;
  duplicate: boolean;
  issues: ValidationIssue[];
  error: string | null;
  handlers: string[];
  interceptors: string[];
  handlerBuiltins: Builtin[];
  interceptorBuiltins: Builtin[];
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onDelete: () => void;
  onEditModule: EditModule;
}

export function RouteEditor(props: Props) {
  const { draft, handlers, interceptors, onChange } = props;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => onChange({ ...draft, [key]: value });

  const [bodyError, setBodyError] = useState<JsonError | null>(null);
  const [headerError, setHeaderError] = useState<JsonError | null>(null);

  useEffect(() => {
    const parsed = parseJson(draft.body || 'null');
    setBodyError('error' in parsed ? parsed.error : null);
  }, [draft.body]);

  useEffect(() => {
    const parsed = parseJson(draft.headers || '{}');
    setHeaderError('error' in parsed ? parsed.error : null);
  }, [draft.headers]);

  const blocked = useMemo(
    () => props.duplicate || (draft.mode === 'static' && (bodyError !== null || headerError !== null)),
    [props.duplicate, draft.mode, bodyError, headerError],
  );

  const format = () => {
    const parsed = parseJson(draft.body);
    if ('value' in parsed) set('body', JSON.stringify(parsed.value, null, 2));
  };

  return (
    <section class="flex h-full flex-1 flex-col overflow-y-auto">
      <header class="flex items-center gap-2 border-b border-[var(--color-border)] px-5 py-3">
        <h2 class="flex-1 font-mono text-sm">
          <span class="text-[var(--color-muted)]">{draft.method}</span> {draft.path}
        </h2>
        {!props.isNew && (
          <Button variant="danger" onClick={props.onDelete} disabled={props.saving}>
            Delete
          </Button>
        )}
        <Button variant="primary" onClick={props.onSave} disabled={props.saving || blocked}>
          {props.saving ? 'Saving…' : props.isNew ? 'Create route' : 'Save route'}
        </Button>
      </header>

      <div class="flex flex-col gap-5 p-5">
        {(props.error || props.issues.length > 0) && (
          <div class="flex gap-2 rounded-md border border-[var(--color-danger)] bg-[color-mix(in_oklch,var(--color-danger)_12%,transparent)] px-3 py-2 text-xs">
            <span class="mt-0.5 text-[var(--color-danger)]">
              <WarnIcon />
            </span>
            <div class="flex-1">
              {props.error && <p>{props.error}</p>}
              {props.issues.map((issue) => (
                <p key={issue.path + issue.message} class="font-mono">
                  {issue.path}: {issue.message}
                </p>
              ))}
            </div>
          </div>
        )}

        <div class="grid grid-cols-[7rem_1fr] gap-3">
          <div>
            <Label>Method</Label>
            <Select value={draft.method} onChange={(e) => set('method', (e.target as HTMLSelectElement).value)}>
              {HTTP_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label hint="use :name for parameters, e.g. /users/:id">Path</Label>
            <Input
              value={draft.path}
              spellcheck={false}
              class={`font-mono ${props.duplicate ? 'border-[var(--color-danger)]' : ''}`}
              onInput={(e) => set('path', (e.target as HTMLInputElement).value)}
            />
            {props.duplicate && (
              <p class="mt-1.5 text-xs text-[var(--color-danger)]">
                Another route already uses {draft.method} {draft.path}
              </p>
            )}
          </div>
        </div>

        <div>
          <Label>Response type</Label>
          <div class="flex gap-4">
            {(['static', 'handler'] as const).map((mode) => (
              <label key={mode} class="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="mode"
                  checked={draft.mode === mode}
                  onChange={() => set('mode', mode)}
                  class="accent-[var(--color-accent)]"
                />
                <span class="capitalize">{mode === 'static' ? 'Static response' : 'JavaScript handler'}</span>
              </label>
            ))}
          </div>
        </div>

        {draft.mode === 'handler' ? (
          <div>
            <div class="flex items-baseline justify-between">
              <Label hint="a file in handlers/">Handler</Label>
              {draft.handler && !draft.handler.startsWith('@') && (
                <button
                  type="button"
                  onClick={() => props.onEditModule('handlers', draft.handler)}
                  class="mb-1.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                >
                  Edit code →
                </button>
              )}
            </div>
            {handlers.length > 0 || props.handlerBuiltins.length > 0 ? (
              <Select value={draft.handler} onChange={(e) => set('handler', (e.target as HTMLSelectElement).value)}>
                <option value="">Select a handler…</option>
                {handlers.length > 0 && (
                  <optgroup label="Your handlers">
                    {handlers.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {props.handlerBuiltins.length > 0 && (
                  <optgroup label="Built in">
                    {props.handlerBuiltins.map((b) => (
                      <option key={b.name} value={b.name}>
                        {b.name} — {b.summary}
                      </option>
                    ))}
                  </optgroup>
                )}
              </Select>
            ) : (
              <p class="text-xs text-[var(--color-muted)]">
                No handlers yet — create one in the{' '}
                <button
                  type="button"
                  onClick={() => props.onEditModule('handlers', '')}
                  class="underline hover:text-[var(--color-fg)]"
                >
                  Code tab
                </button>
                .
              </p>
            )}
          </div>
        ) : (
          <>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <Label>Status</Label>
                <Input
                  type="number"
                  value={draft.status}
                  onInput={(e) => set('status', (e.target as HTMLInputElement).value)}
                />
              </div>
              <div>
                <Label hint="milliseconds">Delay</Label>
                <Input
                  type="number"
                  min="0"
                  value={draft.delayMs}
                  onInput={(e) => set('delayMs', (e.target as HTMLInputElement).value)}
                />
              </div>
            </div>

            <div>
              <div class="flex items-baseline justify-between">
                <Label hint="null for an empty body">Response body</Label>
                <button
                  type="button"
                  onClick={format}
                  disabled={bodyError !== null}
                  class="mb-1.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)] disabled:opacity-40"
                >
                  Format
                </button>
              </div>
              <JsonEditor value={draft.body} onChange={(v) => set('body', v)} error={bodyError} />
            </div>

            <details class="group">
              <summary class="cursor-pointer text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)]">
                Response headers
              </summary>
              <div class="mt-2">
                <JsonEditor
                  value={draft.headers}
                  onChange={(v) => set('headers', v)}
                  error={headerError}
                  rows={4}
                />
              </div>
            </details>
          </>
        )}

        <div class="grid grid-cols-2 gap-4 border-t border-[var(--color-border)] pt-4">
          <div>
            <Label hint="run before the response">Request interceptors</Label>
            <InterceptorPicker
              selected={draft.requestInterceptors}
              available={interceptors}
              builtins={props.interceptorBuiltins}
              onChange={(next) => set('requestInterceptors', next)}
            />
          </div>
          <div>
            <Label hint="run after the response">Response interceptors</Label>
            <InterceptorPicker
              selected={draft.responseInterceptors}
              available={interceptors}
              builtins={props.interceptorBuiltins}
              onChange={(next) => set('responseInterceptors', next)}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
