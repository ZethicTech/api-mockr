import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { api, ApiError, Builtin, ModuleKind } from './api';
import type { MockRoute, Status, ValidationIssue } from './types';
import { RouteList } from './components/RouteList';
import { Draft, RouteEditor, draftToRoute, emptyDraft, toDraft } from './components/RouteEditor';
import { StatusDot, WarnIcon } from './components/primitives';
import { CodeView } from './components/CodeView';

const NEW_ROUTE = '__new__';
const POLL_MS = 2000;

export function App() {
  const [routes, setRoutes] = useState<MockRoute[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [handlers, setHandlers] = useState<string[]>([]);
  const [interceptors, setInterceptors] = useState<string[]>([]);
  const [handlerBuiltins, setHandlerBuiltins] = useState<Builtin[]>([]);
  const [interceptorBuiltins, setInterceptorBuiltins] = useState<Builtin[]>([]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [booted, setBooted] = useState(false);

  const [view, setView] = useState<'routes' | 'code'>('routes');
  const [openFile, setOpenFile] = useState<{ kind: ModuleKind; name: string } | null>(null);

  const selected = routes.find((r) => r.id === selectedId) ?? null;
  const isNew = selectedId === NEW_ROUTE;

  const refresh = useCallback(async () => {
    const [nextRoutes, nextHandlers, nextInterceptors] = await Promise.all([
      api.routes(),
      api.handlers(),
      api.interceptors(),
    ]);
    setRoutes(nextRoutes);
    setHandlers(nextHandlers.handlers);
    setHandlerBuiltins(nextHandlers.builtins);
    setInterceptors(nextInterceptors.interceptors);
    setInterceptorBuiltins(nextInterceptors.builtins);
    return nextRoutes;
  }, []);

  // Initial load.
  useEffect(() => {
    refresh()
      .then((loaded) => {
        if (loaded.length > 0) {
          setSelectedId(loaded[0].id);
          setDraft(toDraft(loaded[0]));
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBooted(true));
  }, [refresh]);

  // Poll status; this is also how out-of-band file edits are noticed, since
  // websockets are deliberately out of scope.
  useEffect(() => {
    let cancelled = false;
    let lastLoadedAt: string | null = null;

    const tick = async () => {
      try {
        const next = await api.status();
        if (cancelled) return;
        setStatus(next);
        // Someone edited mockr.json outside the UI — pull the new routes in.
        if (lastLoadedAt !== null && next.loadedAt !== lastLoadedAt) refresh().catch(() => {});
        lastLoadedAt = next.loadedAt;
      } catch {
        if (!cancelled) setStatus(null);
      }
    };

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [refresh]);

  const select = (id: string) => {
    const route = routes.find((r) => r.id === id);
    if (!route) return;
    setSelectedId(id);
    setDraft(toDraft(route));
    setError(null);
    setIssues([]);
  };

  const createNew = () => {
    setSelectedId(NEW_ROUTE);
    setDraft(emptyDraft());
    setError(null);
    setIssues([]);
  };

  // Flagged before saving, so the server's 422 is a backstop rather than the
  // first time the user hears about it.
  const duplicate = useMemo(() => {
    if (!draft) return false;
    const path = draft.path.trim().replace(/\/+$/, '') || '/';
    return routes.some(
      (r) => r.id !== selectedId && r.method === draft.method && (r.path.replace(/\/+$/, '') || '/') === path,
    );
  }, [draft, routes, selectedId]);

  const dirty = useMemo(() => {
    if (!draft || !selected) return isNew;
    return JSON.stringify(draft) !== JSON.stringify(toDraft(selected));
  }, [draft, selected, isNew]);

  /** Jump from a route straight to the file it points at. */
  const editModule = (kind: ModuleKind, name: string) => {
    setOpenFile(name ? { kind, name } : null);
    setView('code');
  };

  const save = async () => {
    if (!draft) return;
    const built = draftToRoute(draft);
    if ('error' in built) {
      setError(built.error);
      setIssues([]);
      return;
    }

    setSaving(true);
    setError(null);
    setIssues([]);
    try {
      const saved = isNew ? await api.create(built.route) : await api.update(selectedId!, built.route);
      const next = await refresh();
      const found = next.find((r) => r.id === saved.id);
      setSelectedId(saved.id);
      if (found) setDraft(toDraft(found));
    } catch (e) {
      const err = e as ApiError;
      setError(err.message);
      setIssues(err.issues ?? []);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selectedId || isNew) return;
    setSaving(true);
    try {
      await api.remove(selectedId);
      const next = await refresh();
      if (next.length > 0) {
        setSelectedId(next[0].id);
        setDraft(toDraft(next[0]));
      } else {
        setSelectedId(null);
        setDraft(null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="flex h-full flex-col">
      <header class="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-2.5">
        <span class="font-semibold tracking-tight">mockr</span>

        {status && (
          <>
            <a
              href={`http://localhost:${status.mockPort}`}
              target="_blank"
              rel="noreferrer"
              class="font-mono text-xs text-[var(--color-muted)] hover:text-[var(--color-accent)]"
            >
              localhost:{status.mockPort}
            </a>
            <span class="flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
              <StatusDot ok={status.ok} />
              {status.routeCount} route{status.routeCount === 1 ? '' : 's'}
            </span>
          </>
        )}

        <span class="flex-1" />

        {status === null && booted && (
          <span class="text-xs text-[var(--color-danger)]">server unreachable</span>
        )}

        <nav class="flex gap-1 rounded-md border border-[var(--color-border)] p-0.5 text-xs">
          {(['routes', 'code'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setView(tab)}
              class={`rounded px-2.5 py-1 capitalize transition-colors ${
                view === tab
                  ? 'bg-[var(--color-surface-hover)] text-[var(--color-fg)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-fg)]'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </header>

      {status && status.errors.length > 0 && (
        <div class="flex items-start gap-2 border-b border-[var(--color-danger)] bg-[color-mix(in_oklch,var(--color-danger)_12%,transparent)] px-4 py-2 text-xs">
          <span class="mt-0.5 text-[var(--color-danger)]">
            <WarnIcon />
          </span>
          <div>
            {status.errors.map((e, i) => (
              <p key={i} class="font-mono">
                {e.scope}
                {e.name ? ` "${e.name}"` : ''}: {e.message}
              </p>
            ))}
            <p class="mt-0.5 text-[var(--color-muted)]">
              Serving the last valid configuration until this is fixed.
            </p>
          </div>
        </div>
      )}

      {view === 'code' ? (
        <CodeView handlers={handlers} interceptors={interceptors} initial={openFile} onChanged={refresh} />
      ) : (
        <main class="flex min-h-0 flex-1">
          <RouteList
            routes={routes}
            selectedId={selectedId}
            dirty={dirty}
            onSelect={select}
            onCreate={createNew}
          />

          {draft ? (
            <RouteEditor
              draft={draft}
              isNew={isNew}
              saving={saving}
              duplicate={duplicate}
              issues={issues}
              error={error}
              handlers={handlers}
              interceptors={interceptors}
              handlerBuiltins={handlerBuiltins}
              interceptorBuiltins={interceptorBuiltins}
              onChange={setDraft}
              onSave={save}
              onDelete={remove}
              onEditModule={editModule}
            />
          ) : (
            <section class="flex flex-1 items-center justify-center text-sm text-[var(--color-muted)]">
              {booted ? 'Select a route, or create one.' : 'Loading…'}
            </section>
          )}
        </main>
      )}
    </div>
  );
}
