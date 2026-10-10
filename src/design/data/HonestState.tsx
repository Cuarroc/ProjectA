import { Button } from "../controls/Button";
import "./data.css";

export type HonestKind = "empty" | "offline" | "locked";

export interface HonestStateProps {
  kind: HonestKind;
  title?: string;
  hint?: string;
  action?: { label: string; onClick: () => void };
}

const WORDS: Record<HonestKind, string> = {
  empty: "Noch nichts da",
  offline: "Nicht verbunden",
  locked: "Gesperrt",
};

// A placeholder for missing data must never look like a measurement: a "0" or
// "3 offen" in an empty, unconnected or locked area reads as a real value.
// Text with a digit is not rendered (title falls back to the kind's word, hint
// and action are dropped); numbers belong in Table or KeyValue.
const clean = (s?: string) => (s && !/\d/.test(s) ? s : undefined);

/** Empty, not connected or locked: says so in words, shows no number. */
export function HonestState({ kind, title, hint, action }: HonestStateProps) {
  const label = clean(action?.label);
  return (
    <div className={`g-hs g-hs--${kind}`}>
      <span className="g-hs__mark" aria-hidden="true" />
      <p className="g-hs__title">{clean(title) ?? WORDS[kind]}</p>
      {clean(hint) && <p className="g-hs__hint">{clean(hint)}</p>}
      {action && label && <Button size="sm" variant="tint" onClick={action.onClick}>{label}</Button>}
    </div>
  );
}
