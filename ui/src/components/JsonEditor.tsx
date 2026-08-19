import { useEffect, useMemo, useRef } from 'preact/hooks';

interface Props {
  value: string;
  onChange: (value: string) => void;
  error: JsonError | null;
  rows?: number;
}

export interface JsonError {
  message: string;
  line: number;
}

/**
 * Parse JSON, mapping a failure to a line number.
 * V8 reports a character position, which we walk back to a line.
 */
export function parseJson(text: string): { value: unknown } | { error: JsonError } {
  try {
    return { value: JSON.parse(text) };
  } catch (err) {
    const message = (err as Error).message;
    const at = /position (\d+)/.exec(message);
    const line = at ? text.slice(0, Number(at[1])).split('\n').length : 1;
    return { error: { message: message.replace(/ in JSON at position \d+.*/, ''), line } };
  }
}

type TokenKind = 'key' | 'string' | 'number' | 'literal' | 'punct';

const TOKEN_CLASS: Record<TokenKind, string> = {
  key: 'text-[var(--color-accent)]',
  string: 'text-[var(--color-ok)]',
  number: 'text-[var(--color-warn)]',
  literal: 'text-[var(--color-danger)]',
  punct: 'text-[var(--color-muted)]',
};

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Minimal JSON tokenizer for the highlight overlay.
 * JSON is a small enough grammar that this beats pulling in an editor library.
 */
function highlight(source: string): string {
  const pattern =
    /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])/g;

  let out = '';
  let last = 0;

  for (const m of source.matchAll(pattern)) {
    const index = m.index ?? 0;
    out += escapeHtml(source.slice(last, index));

    let kind: TokenKind;
    if (m[1] !== undefined) kind = m[2] ? 'key' : 'string';
    else if (m[3] !== undefined) kind = 'number';
    else if (m[4] !== undefined) kind = 'literal';
    else kind = 'punct';

    out += `<span class="${TOKEN_CLASS[kind]}">${escapeHtml(m[1] ?? m[3] ?? m[4] ?? m[5] ?? '')}</span>`;
    if (m[2]) out += `<span class="${TOKEN_CLASS.punct}">${escapeHtml(m[2])}</span>`;

    last = index + m[0].length;
  }

  return out + escapeHtml(source.slice(last));
}

export function JsonEditor({ value, onChange, error, rows = 14 }: Props) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const overlay = useRef<HTMLPreElement>(null);
  const gutter = useRef<HTMLDivElement>(null);

  const lines = useMemo(() => value.split('\n').length, [value]);
  const html = useMemo(() => highlight(value), [value]);

  // Keep the highlight layer and gutter locked to the textarea's scroll.
  const sync = () => {
    const el = textarea.current;
    if (!el) return;
    if (overlay.current) {
      overlay.current.scrollTop = el.scrollTop;
      overlay.current.scrollLeft = el.scrollLeft;
    }
    if (gutter.current) gutter.current.scrollTop = el.scrollTop;
  };

  useEffect(sync, [value]);

  const onKeyDown = (e: KeyboardEvent) => {
    const el = textarea.current;
    if (!el) return;

    // Tab indents instead of leaving the field — this is an editor.
    if (e.key === 'Tab') {
      e.preventDefault();
      const { selectionStart: start, selectionEnd: end } = el;
      const next = `${value.slice(0, start)}  ${value.slice(end)}`;
      onChange(next);
      requestAnimationFrame(() => el.setSelectionRange(start + 2, start + 2));
    }
  };

  return (
    <div>
      <div
        class={`relative flex overflow-hidden rounded-md border bg-[var(--color-bg)] font-mono text-[13px] leading-[1.55] ${
          error ? 'border-[var(--color-danger)]' : 'border-[var(--color-border)]'
        }`}
      >
        <div
          ref={gutter}
          class="select-none overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2.5 text-right text-[var(--color-muted)]"
          aria-hidden="true"
        >
          {Array.from({ length: lines }, (_, i) => (
            <div key={i} class={error?.line === i + 1 ? 'text-[var(--color-danger)]' : undefined}>
              {i + 1}
            </div>
          ))}
        </div>

        <div class="relative flex-1">
          <pre
            ref={overlay}
            class="pointer-events-none absolute inset-0 overflow-auto whitespace-pre-wrap break-words p-2.5"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: html + '\n' }}
          />
          <textarea
            ref={textarea}
            value={value}
            rows={rows}
            spellcheck={false}
            autocapitalize="off"
            autocomplete="off"
            onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)}
            onScroll={sync}
            onKeyDown={onKeyDown}
            class="relative block w-full resize-y overflow-auto whitespace-pre-wrap break-words bg-transparent p-2.5 text-transparent caret-[var(--color-fg)] focus:outline-none"
          />
        </div>
      </div>

      {error && (
        <p class="mt-1.5 text-xs text-[var(--color-danger)]">
          Line {error.line}: {error.message}
        </p>
      )}
    </div>
  );
}
