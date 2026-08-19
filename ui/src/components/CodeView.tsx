import { useEffect, useState } from 'preact/hooks';
import { ApiError, HANDLER_TEMPLATE, INTERCEPTOR_TEMPLATE, ModuleKind, api } from '../api';
import { Button, PlusIcon, WarnIcon } from './primitives';
import { CodeEditor } from './CodeEditor';

interface Props {
  handlers: string[];
  interceptors: string[];
  initial: { kind: ModuleKind; name: string } | null;
  onChanged: () => Promise<unknown>;
}

interface Open {
  kind: ModuleKind;
  name: string;
  ext: string;
  source: string;
  saved: string;
  isNew: boolean;
}

const LABEL: Record<ModuleKind, string> = { handlers: 'Handlers', interceptors: 'Interceptors' };

/** Extract a line number from a syntax error message, if it carries one. */
function errorLineOf(message: string | null): number | null {
  if (!message) return null;
  const m = /:(\d+)\b/.exec(message);
  return m ? Number(m[1]) : null;
}

export function CodeView({ handlers, interceptors, initial, onChanged }: Props) {
  const [open, setOpen] = useState<Open | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  const load = async (kind: ModuleKind, name: string) => {
    setError(null);
    setDetail(null);
    try {
      const file = await api.readModule(kind, name);
      setOpen({ kind, name, ext: file.ext, source: file.source, saved: file.source, isNew: false });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Open whatever the route editor asked for.
  useEffect(() => {
    if (initial?.name) load(initial.kind, initial.name);
  }, [initial?.kind, initial?.name]);

  const create = (kind: ModuleKind) => {
    const name = prompt(`New ${kind === 'handlers' ? 'handler' : 'interceptor'} name`, '')?.trim();
    if (!name) return;
    setError(null);
    setDetail(null);
    setOpen({
      kind,
      name,
      ext: '',
      source: kind === 'handlers' ? HANDLER_TEMPLATE : INTERCEPTOR_TEMPLATE,
      saved: '',
      isNew: true,
    });
  };

  const save = async () => {
    if (!open) return;
    setBusy(true);
    setError(null);
    setDetail(null);
    try {
      const written = await api.writeModule(open.kind, open.name, open.source);
      setOpen({ ...open, ext: written.ext, saved: written.source, isNew: false });
      await onChanged();
    } catch (e) {
      const err = e as ApiError;
      setError(err.message);
      // For a syntax error the API also returns the parser's own message.
      setDetail(err.detail);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!open || open.isNew) return;
    if (!confirm(`Delete ${open.name}${open.ext}? Routes using it will stop working.`)) return;
    setBusy(true);
    try {
      await api.deleteModule(open.kind, open.name);
      setOpen(null);
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const dirty = open !== null && open.source !== open.saved;

  const group = (kind: ModuleKind, names: string[]) => (
    <div class="mb-3">
      <div class="flex items-center justify-between px-3 py-1.5">
        <span class="text-xs font-medium text-[var(--color-muted)]">{LABEL[kind]}</span>
        <button
          type="button"
          onClick={() => create(kind)}
          class="rounded p-1 text-[var(--color-muted)] hover:text-[var(--color-fg)]"
          aria-label={`New ${kind}`}
          title={`New ${LABEL[kind].slice(0, -1).toLowerCase()}`}
        >
          <PlusIcon />
        </button>
      </div>

      {names.length === 0 && <p class="px-3 pb-1 text-xs text-[var(--color-muted)]">None yet</p>}

      {names.map((name) => {
        const selected = open?.kind === kind && open?.name === name;
        return (
          <button
            key={`${kind}/${name}`}
            type="button"
            onClick={() => load(kind, name)}
            class={`flex w-full items-center gap-2 border-l-2 px-3 py-1.5 text-left font-mono text-[13px] transition-colors ${
              selected
                ? 'border-[var(--color-accent)] bg-[var(--color-surface-hover)]'
                : 'border-transparent hover:bg-[var(--color-surface-hover)]'
            }`}
          >
            <span class="flex-1 truncate">{name}</span>
            {selected && dirty && <span class="text-[var(--color-warn)]">●</span>}
          </button>
        );
      })}
    </div>
  );

  return (
    <main class="flex min-h-0 flex-1">
      <aside class="flex h-full w-72 shrink-0 flex-col overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-surface)] py-2">
        {group('handlers', handlers)}
        {group('interceptors', interceptors)}
      </aside>

      {open ? (
        <section class="flex min-h-0 flex-1 flex-col">
          <header class="flex items-center gap-2 border-b border-[var(--color-border)] px-5 py-3">
            <h2 class="flex-1 font-mono text-sm">
              {open.kind}/{open.name}
              <span class="text-[var(--color-muted)]">{open.ext || '.js'}</span>
            </h2>
            {!open.isNew && (
              <Button variant="danger" onClick={remove} disabled={busy}>
                Delete
              </Button>
            )}
            <Button variant="primary" onClick={save} disabled={busy || (!dirty && !open.isNew)}>
              {busy ? 'Saving…' : open.isNew ? 'Create file' : 'Save'}
            </Button>
          </header>

          <div class="flex min-h-0 flex-1 flex-col gap-3 p-5">
            {error && (
              <div class="flex gap-2 rounded-md border border-[var(--color-danger)] bg-[color-mix(in_oklch,var(--color-danger)_12%,transparent)] px-3 py-2 text-xs">
                <span class="mt-0.5 text-[var(--color-danger)]">
                  <WarnIcon />
                </span>
                <div>
                  <p>{error}</p>
                  {detail && <p class="font-mono">{detail}</p>}
                  <p class="mt-0.5 text-[var(--color-muted)]">The previous version is still being served.</p>
                </div>
              </div>
            )}

            <CodeEditor
              value={open.source}
              onChange={(source) => setOpen({ ...open, source })}
              errorLine={errorLineOf(detail)}
            />

            <p class="text-xs text-[var(--color-muted)]">
              CommonJS — use <code class="font-mono">module.exports</code> and{' '}
              <code class="font-mono">require</code>. Any package you require must be installed in your own
              project. Saving reloads immediately.
            </p>
          </div>
        </section>
      ) : (
        <section class="flex flex-1 items-center justify-center text-sm text-[var(--color-muted)]">
          Select a file, or create one.
        </section>
      )}
    </main>
  );
}
