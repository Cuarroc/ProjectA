import { Fragment, type ReactNode } from "react";
import "./data.css";

export interface KeyValueItem {
  label: string;
  value: ReactNode;
  /** Stable identity when labels may repeat; defaults to the row position. */
  key?: string;
}

/** Term/definition list. `box` frames it as a card with row dividers. */
export function KeyValue({ items, box = false }: { items: readonly KeyValueItem[]; box?: boolean }) {
  return (
    <dl className={box ? "g-kv g-kv--box" : "g-kv"}>
      {items.map(({ label, value, key }, i) => (
        <Fragment key={key ?? i}>
          <dt>{label}</dt>
          <dd title={typeof value === "string" ? value : undefined}>{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
