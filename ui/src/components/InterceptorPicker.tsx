import type { Builtin } from '../api';
import { Chip, Select } from './primitives';

interface Props {
  selected: string[];
  available: string[];
  builtins: Builtin[];
  onChange: (next: string[]) => void;
}

/** Ordered interceptor chips plus a dropdown of what exists on disk. */
export function InterceptorPicker({ selected, available, builtins, onChange }: Props) {
  const remaining = available.filter((name) => !selected.includes(name));
  const remainingBuiltins = builtins.filter((b) => !selected.includes(b.name));

  return (
    <div class="flex flex-wrap items-center gap-1.5">
      {selected.map((name, i) => (
        <Chip key={name} label={name} onRemove={() => onChange(selected.filter((_, j) => j !== i))} />
      ))}

      {remaining.length > 0 || remainingBuiltins.length > 0 ? (
        <Select
          class="w-auto py-1 text-xs"
          value=""
          onChange={(e) => {
            const name = (e.target as HTMLSelectElement).value;
            if (name) onChange([...selected, name]);
            (e.target as HTMLSelectElement).value = '';
          }}
        >
          <option value="">+ add</option>
          {remaining.length > 0 && (
            <optgroup label="Yours">
              {remaining.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </optgroup>
          )}
          {remainingBuiltins.length > 0 && (
            <optgroup label="Built in">
              {remainingBuiltins.map((b) => (
                <option key={b.name} value={b.name} title={b.summary}>
                  {b.name} — {b.summary}
                </option>
              ))}
            </optgroup>
          )}
        </Select>
      ) : (
        <span class="text-xs text-[var(--color-muted)]">All available interceptors are attached</span>
      )}
    </div>
  );
}
