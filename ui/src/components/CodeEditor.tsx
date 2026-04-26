import { useEffect, useMemo, useRef } from 'preact/hooks';

interface Props {
  value: string;
  onChange: (value: string) => void;
  errorLine?: number | null;
  rows?: number;
}

const KEYWORDS =
  /\b(async|await|break|case|catch|class|const|continue|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|of|return|super|switch|this|throw|try|typeof|var|void|while|yield)\b/;

const LITERALS = /\b(true|false|null|undefined|NaN|Infinity)\b/;

const TOKEN = new RegExp(
  [
    '(//[^\\n]*|/\\*[\\s\\S]*?\\*/)', // 1 comment
    '(`(?:\\\\.|[^`\\\\])*`|"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\')', // 2 string
    KEYWORDS.source.replace(/^\\b|\\b$/g, ''), // 3 keyword
    LITERALS.source.replace(/^\\b|\\b$/g, ''), // 4 literal
    '(\\b\\d+(?:\\.\\d+)?\\b)', // 5 number
    '(\\b[A-Za-z_$][\\w$]*(?=\\s*\\())', // 6 call
  ].join('|'),
  'g',
);

const CLASSES = [
  '',
  'text-[var(--color-muted)] italic', // comment
  'text-[var(--color-ok)]', // string
  'text-[var(--color-accent)]', // keyword
  'text-[var(--color-danger)]', // literal
  'text-[var(--color-warn)]', // number
  'text-[oklch(0.8_0.12_300)]', // call
];

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Small JavaScript tokenizer for the highlight overlay.
 * Good enough to read code by; it is not a parser and does not need to be.
 */
function highlight(source: string): string {
  let out = '';
  let last = 0;

  for (const m of source.matchAll(TOKEN)) {
    const index = m.index ?? 0;
    out += escapeHtml(source.slice(last, index));

    const group = m.slice(1).findIndex((g) => g !== undefined) + 1;
    out += `<span class="${CLASSES[group] ?? ''}">${escapeHtml(m[0])}</span>`;

    last = index + m[0].length;
  }

  return out + escapeHtml(source.slice(last));
}

/** Keep indentation when adding a line, and add one inside an opening brace. */
function indentFor(value: string, caret: number): string {
  const line = value.slice(0, caret).split('\n').pop() ?? '';
  const current = /^[ \t]*/.exec(line)?.[0] ?? '';
  return /[{([]\s*$/.test(line) ? current + '  ' : current;
}

export function CodeEditor({ value, onChange, errorLine = null, rows = 20 }: Props) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const overlay = useRef<HTMLPreElement>(null);
  const gutter = useRef<HTMLDivElement>(null);

  const lines = useMemo(() => value.split('\n').length, [value]);
  const html = useMemo(() => highlight(value), [value]);

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
    const { selectionStart: start, selectionEnd: end } = el;

    if (e.key === 'Tab') {
      e.preventDefault();
      onChange(`${value.slice(0, start)}  ${value.slice(end)}`);
      requestAnimationFrame(() => el.setSelectionRange(start + 2, start + 2));
      return;
    }

    if (e.key === 'Enter') {
      const indent = indentFor(value, start);
      if (indent.length === 0) return;
      e.preventDefault();
      onChange(`${value.slice(0, start)}\n${indent}${value.slice(end)}`);
      const next = start + 1 + indent.length;
      requestAnimationFrame(() => el.setSelectionRange(next, next));
    }
  };

  return (
    <div class="flex min-h-0 flex-1 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] font-mono text-[13px] leading-[1.55]">
      <div
        ref={gutter}
        class="select-none overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2.5 text-right text-[var(--color-muted)]"
        aria-hidden="true"
      >
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} class={errorLine === i + 1 ? 'text-[var(--color-danger)]' : undefined}>
            {i + 1}
          </div>
        ))}
      </div>

      <div class="relative min-w-0 flex-1">
        <pre
          ref={overlay}
          class="pointer-events-none absolute inset-0 overflow-auto whitespace-pre p-2.5"
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
          class="absolute inset-0 block h-full w-full resize-none overflow-auto whitespace-pre bg-transparent p-2.5 text-transparent caret-[var(--color-fg)] focus:outline-none"
        />
      </div>
    </div>
  );
}
