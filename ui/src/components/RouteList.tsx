import type { MockRoute } from '../types';
import { isHandlerRoute } from '../types';
import { Button, MethodBadge, PlusIcon } from './primitives';

interface Props {
  routes: MockRoute[];
  selectedId: string | null;
  dirty: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export function RouteList({ routes, selectedId, dirty, onSelect, onCreate }: Props) {
  return (
    <aside class="flex h-full w-72 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
      <div class="p-2">
        <Button variant="ghost" class="flex w-full items-center justify-center gap-1.5" onClick={onCreate}>
          <PlusIcon />
          New route
        </Button>
      </div>

      <nav class="flex-1 overflow-y-auto pb-2">
        {routes.length === 0 && (
          <p class="px-3 py-6 text-center text-xs text-[var(--color-muted)]">
            No routes yet. Create one to get started.
          </p>
        )}

        {routes.map((route) => {
          const selected = route.id === selectedId;
          return (
            <button
              key={route.id}
              type="button"
              onClick={() => onSelect(route.id)}
              class={`flex w-full items-baseline gap-2 border-l-2 px-3 py-2 text-left transition-colors ${
                selected
                  ? 'border-[var(--color-accent)] bg-[var(--color-surface-hover)]'
                  : 'border-transparent hover:bg-[var(--color-surface-hover)]'
              }`}
            >
              <MethodBadge method={route.method} />
              <span class="flex-1 truncate font-mono text-[13px]">{route.path}</span>
              {selected && dirty && (
                <span class="text-[var(--color-warn)]" title="Unsaved changes">
                  ●
                </span>
              )}
              <span class="font-mono text-[11px] text-[var(--color-muted)]">
                {isHandlerRoute(route) ? 'fn' : (route.response?.status ?? 200)}
              </span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
