import { Chip, Select } from './primitives';

interface Props {
  selected: string[];
  available: string[];
  onChange: (next: string[]) => void;
}

/** Ordered interceptor chips plus a dropdown of what exists on disk. */
export function InterceptorPicker({ selected, available, onChange }: Props) {
  const remaining = available.filter((name) => !selected.includes(name));

  return (
    <div class="flex flex-wrap items-center gap-1.5">
      {selected.map((name, i) => (
        <Chip key={name} label={name} onRemove={() => onChange(selected.filter((_, j) => j !== i))} />
      ))}

      {remaining.length > 0 ? (
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
          {remaining.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
      ) : (
        available.length === 0 && (
          <span class="text-xs text-[var(--color-muted)]">
            None found — add a file to interceptors/
          </span>
        )
      )}
    </div>
  );
}
