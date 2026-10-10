import { useRef, type KeyboardEvent, type ReactNode } from "react";

export interface TabsProps<T extends string> {
  /** Prefix that ties each tab to its panel (`${idBase}-tab-${id}` / `${idBase}-panel-${id}`). */
  idBase: string;
  tabs: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  "aria-label": string;
}

const STEP: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };

/** Tablist: one tab stop (the selected tab), arrows move and select, Home/End jump. */
export function Tabs<T extends string>({ idBase, tabs, value, onChange, "aria-label": label }: TabsProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(0, tabs.findIndex((t) => t.id === value));

  const select = (index: number) => {
    onChange(tabs[index].id);
    refs.current[index]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const n = tabs.length;
    if (e.key in STEP) select((current + STEP[e.key] + n) % n);
    else if (e.key === "Home") select(0);
    else if (e.key === "End") select(n - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div role="tablist" aria-label={label} className="g-tabs" onKeyDown={onKeyDown}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          role="tab"
          id={`${idBase}-tab-${t.id}`}
          aria-controls={`${idBase}-panel-${t.id}`}
          aria-selected={i === current}
          tabIndex={i === current ? 0 : -1}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Panel of the tab with the same `idBase` and `id`; hidden unless `active`. */
export function TabPanel({ idBase, id, active, children }: { idBase: string; id: string; active: boolean; children?: ReactNode }) {
  return (
    <div role="tabpanel" className="g-tabpanel" id={`${idBase}-panel-${id}`} aria-labelledby={`${idBase}-tab-${id}`} hidden={!active}>
      {active ? children : null}
    </div>
  );
}
