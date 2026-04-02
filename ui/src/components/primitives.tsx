import type { ComponentChildren, JSX } from 'preact';

/** shadcn-shaped primitives over native elements — no Radix, no React internals. */

const BASE_FIELD =
  'w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 ' +
  'placeholder:text-[var(--color-muted)] disabled:opacity-50';

export const Input = (props: JSX.IntrinsicElements['input']) => (
  <input {...props} class={`${BASE_FIELD} ${props.class ?? ''}`} />
);

export const Select = (props: JSX.IntrinsicElements['select']) => (
  <select {...props} class={`${BASE_FIELD} cursor-pointer ${props.class ?? ''}`} />
);

export function Label({ children, hint }: { children: ComponentChildren; hint?: string }) {
  return (
    <label class="mb-1.5 flex items-baseline gap-2 text-xs font-medium text-[var(--color-muted)]">
      {children}
      {hint && <span class="font-normal opacity-70">{hint}</span>}
    </label>
  );
}

type ButtonProps = JSX.IntrinsicElements['button'] & {
  variant?: 'primary' | 'ghost' | 'danger';
};

export function Button({ variant = 'ghost', ...props }: ButtonProps) {
  const styles = {
    primary:
      'bg-[var(--color-accent)] text-[var(--color-accent-fg)] font-medium hover:opacity-90 disabled:opacity-40',
    ghost:
      'border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] disabled:opacity-40',
    danger:
      'border border-transparent text-[var(--color-danger)] hover:bg-[color-mix(in_oklch,var(--color-danger)_15%,transparent)] disabled:opacity-40',
  }[variant];

  return (
    <button
      {...props}
      class={`rounded-md px-3 py-1.5 transition-colors disabled:cursor-not-allowed ${styles} ${props.class ?? ''}`}
    />
  );
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-[var(--color-ok)]',
  POST: 'text-[var(--color-accent)]',
  PUT: 'text-[var(--color-warn)]',
  PATCH: 'text-[var(--color-warn)]',
  DELETE: 'text-[var(--color-danger)]',
  HEAD: 'text-[var(--color-muted)]',
};

export const MethodBadge = ({ method }: { method: string }) => (
  <span class={`font-mono text-[11px] font-semibold tracking-wide ${METHOD_COLORS[method] ?? ''}`}>
    {method.padEnd(6, ' ')}
  </span>
);

export function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      class={`inline-block h-2 w-2 rounded-full ${ok ? 'bg-[var(--color-ok)]' : 'bg-[var(--color-danger)]'}`}
      title={ok ? 'loaded' : 'error'}
    />
  );
}

/** Removable chip used for interceptor lists. */
export function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span class="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-0.5 pl-2 pr-1 font-mono text-xs">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        class="rounded px-1 text-[var(--color-muted)] hover:text-[var(--color-danger)]"
      >
        ×
      </button>
    </span>
  );
}

export const PlusIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
  </svg>
);

export const WarnIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M8 1.5 15 14H1L8 1.5Z M8 6.5v3.5 M8 12.2v.1"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
);
