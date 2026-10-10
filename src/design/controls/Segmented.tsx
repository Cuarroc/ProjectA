import { useRef, type KeyboardEvent } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  "aria-label": string;
}

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * Radio group: one tab stop (the selected option), arrows move and select, Home/End jump.
 * A value that matches no option falls back to the first option as checked tab stop;
 * with no options the keys do nothing.
 */
export function Segmented<T extends string>({ options, value, onChange, "aria-label": label }: SegmentedProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(0, options.findIndex((o) => o.value === value));

  const select = (index: number) => {
    onChange(options[index].value);
    refs.current[index]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const n = options.length;
    if (n === 0) return;
    if (e.key in STEP) select((current + STEP[e.key] + n) % n);
    else if (e.key === "Home") select(0);
    else if (e.key === "End") select(n - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div role="radiogroup" aria-label={label} className="g-seg" onKeyDown={onKeyDown}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          role="radio"
          aria-checked={i === current}
          tabIndex={i === current ? 0 : -1}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
