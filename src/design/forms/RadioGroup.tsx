import { useRef, type KeyboardEvent, type ReactNode } from "react";

export interface RadioOption<T extends string> {
  value: T;
  label: ReactNode;
}

export interface RadioGroupProps<T extends string> {
  options: readonly RadioOption<T>[];
  value: T;
  onChange: (value: T) => void;
  "aria-label": string;
}

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * Radio group, same roving idiom as Segmented: one tab stop (the selected option), arrows move and select,
 * Home/End jump, nothing happens during IME composition. A value that matches no option makes the first one the tab stop.
 */
export function RadioGroup<T extends string>({ options, value, onChange, "aria-label": label }: RadioGroupProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(0, options.findIndex((o) => o.value === value));

  const select = (index: number) => {
    onChange(options[index].value);
    refs.current[index]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    const n = options.length;
    if (n === 0) return;
    if (e.key in STEP) select((current + STEP[e.key] + n) % n);
    else if (e.key === "Home") select(0);
    else if (e.key === "End") select(n - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div role="radiogroup" aria-label={label} className="g-rg" onKeyDown={onKeyDown}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          role="radio"
          className="g-rg__opt"
          aria-checked={i === current}
          tabIndex={i === current ? 0 : -1}
          onClick={() => onChange(o.value)}
        >
          <span className="g-rg__dot" aria-hidden="true" />
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}
