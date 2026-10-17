import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";

export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  /** Presence marks the control invalid; the text is announced, so the red border is never the only signal. */
  error?: ReactNode;
  /** Spread the control props onto the one input, textarea or select. */
  children: (control: FieldControlProps) => ReactNode;
}

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** One label, optional hint and error, wired to one control by generated ids. State attributes: data-invalid, data-filled, data-focused. */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [filled, setFilled] = useState(false);
  const [focused, setFocused] = useState(false);
  const hasHint = hint != null && hint !== false;
  const invalid = error != null && error !== false;
  const describedBy = [hasHint && `${id}-hint`, invalid && `${id}-error`].filter(Boolean).join(" ");
  // shortcut: a value set from code after mount is not seen, only typing and the first render; upgrade when a caller needs it.
  const sync = (e: FormEvent) => setFilled((e.target as Control).value !== "");
  useEffect(() => setFilled((root.current?.querySelector<Control>("input, textarea, select")?.value ?? "") !== ""), []);
  return (
    <div
      ref={root}
      className="g-field"
      data-invalid={invalid || undefined}
      data-filled={filled || undefined}
      data-focused={focused || undefined}
      onChange={sync}
      onInput={sync}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <label className="g-field__label" htmlFor={id}>{label}</label>
      {children({ id, "aria-describedby": describedBy || undefined, "aria-invalid": invalid ? true : undefined })}
      {hasHint ? <p className="g-field__hint" id={`${id}-hint`}>{hint}</p> : null}
      {invalid ? <p className="g-field__error" id={`${id}-error`} role="alert">{error}</p> : null}
    </div>
  );
}
