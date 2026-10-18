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

/**
 * Tablist: one tab stop (the selected tab), arrows move and select, Home/End jump.
 * An empty list ignores those keys. A value that matches no tab selects none
 * and leaves the first tab as the only tab stop.
 */
export function Tabs<T extends string>({ idBase, tabs, value, onChange, "aria-label": label }: TabsProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const matched = tabs.findIndex((t) => t.id === value);
  const current = Math.max(0, matched);

  const select = (index: number) => {
    const tab = tabs[index];
    if (!tab) return;
    onChange(tab.id);
    refs.current[index]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const n = tabs.length;
    if (n === 0) return;
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
          aria-selected={i === matched}
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

/**
 * Tabs that are links (route views without panels): the tab keyboard model of `Tabs`
 * (one tab stop, arrows and Home/End) but moving only focus - Enter follows the link.
 * The current link carries `aria-current="page"`.
 */
export function TabLinks<T extends string>({ tabs, value, "aria-label": label, className }: {
  tabs: readonly { id: T; label: string; href: string }[];
  value: T;
  "aria-label": string;
  className?: string;
}) {
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);
  const current = Math.max(0, tabs.findIndex((t) => t.id === value));
  const onKeyDown = (e: KeyboardEvent) => {
    const n = tabs.length;
    const here = refs.current.findIndex((el) => el === e.target);
    if (n === 0 || here < 0) return;
    if (e.key in STEP) refs.current[(here + STEP[e.key] + n) % n]?.focus();
    else if (e.key === "Home") refs.current[0]?.focus();
    else if (e.key === "End") refs.current[n - 1]?.focus();
    else return;
    e.preventDefault();
  };
  return (
    <nav aria-label={label} className={["g-tabs", className].filter(Boolean).join(" ")} onKeyDown={onKeyDown}>
      {tabs.map((t, i) => (
        <a
          key={t.id}
          ref={(el) => { refs.current[i] = el; }}
          href={t.href}
          aria-current={t.id === value ? "page" : undefined}
          tabIndex={i === current ? 0 : -1}
        >
          {t.label}
        </a>
      ))}
    </nav>
  );
}
