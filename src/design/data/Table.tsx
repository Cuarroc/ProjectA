import { useState, type KeyboardEvent, type ReactNode } from "react";
import { de } from "../../i18n/de";
import { Checkbox } from "../forms/Checkbox";
import { HonestState } from "./HonestState";
import "./data.css";

export interface Column<Row> {
  key: string;
  header: string;
  numeric?: boolean;
  cell: (row: Row) => ReactNode;
  /** Makes the header a sort button; the value is compared as a number or as text. */
  sortValue?: (row: Row) => string | number;
}

export interface TableSelection<Row> {
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  /** Accessible name part of a row's checkbox; the row key when missing. */
  rowLabel?: (row: Row) => string;
}

export interface TableProps<Row> {
  /** Accessible name of the scroll region; also names the table. */
  label: string;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** Shown instead of the table for zero rows; plain text is drawn as HonestState. */
  empty?: ReactNode;
  /** Replaces the table with a HonestState while data loads. */
  loading?: boolean;
  /** Adds a checkbox column; the caller owns the selected keys. */
  selection?: TableSelection<Row>;
}

type SortDir = "ascending" | "descending";

const fill = (text: string, vars: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k]));
const compare = (a: string | number, b: string | number) =>
  typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "de", { numeric: true });

export function Table<Row>({ label, columns, rows, rowKey, empty, loading, selection }: TableProps<Row>) {
  // none -> ascending -> descending -> none; one column at a time.
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(null);
  if (loading) return <div role="status"><HonestState kind="empty" title={de["table.loading"]} /></div>;
  if (rows.length === 0) {
    if (typeof empty === "string") return <HonestState kind="empty" title={empty} />;
    if (empty) return <>{empty}</>;
    return null;
  }
  const num = (c: Column<Row>) => (c.numeric ? "g-tbl__n" : undefined);
  const cycle = (key: string) => setSort((s) => (s?.key !== key ? { key, dir: "ascending" } : s.dir === "ascending" ? { key, dir: "descending" } : null));
  const column = columns.find((c) => c.key === sort?.key);
  const shown = !sort || !column?.sortValue ? rows : [...rows].sort((a, b) => compare(column.sortValue!(a), column.sortValue!(b)) * (sort.dir === "ascending" ? 1 : -1));
  const keys = rows.map(rowKey);
  const picked = selection ? keys.filter((k) => selection.selected.has(k)).length : 0;
  const toggle = (key: string, on: boolean) => {
    const next = new Set(selection!.selected);
    if (on) next.add(key); else next.delete(key);
    selection!.onChange(next);
  };
  const header = (c: Column<Row>) => {
    if (!c.sortValue) return <th key={c.key} scope="col" className={num(c)}>{c.header}</th>;
    const dir = sort?.key === c.key ? sort.dir : "none";
    // Enter and Space are handled here, not left to the click a browser derives from them, so both paths cycle exactly once.
    const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      cycle(c.key);
    };
    return (
      <th key={c.key} scope="col" className={num(c)} aria-sort={dir}>
        <button type="button" className="g-tbl__sort" onClick={() => cycle(c.key)} onKeyDown={onKeyDown} onKeyUp={(e) => e.key === " " && e.preventDefault()}>{c.header}</button>
      </th>
    );
  };
  const table = (
    <div className="g-tw" role="region" aria-label={label} tabIndex={0}>
      <table className="g-tbl">
        <thead>
          <tr>
            {selection && (
              <th scope="col" className="g-tbl__sel">
                <Checkbox label={<span className="sr-only">{de["table.selectAll"]}</span>} checked={picked === 0 ? false : picked === keys.length ? true : "mixed"} onCheckedChange={(on) => selection.onChange(on ? new Set(keys) : new Set())} />
              </th>
            )}
            {columns.map(header)}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => {
            const key = rowKey(row);
            return (
              <tr key={key} aria-selected={selection ? selection.selected.has(key) : undefined}>
                {selection && (
                  <td className="g-tbl__sel">
                    <Checkbox label={<span className="sr-only">{fill(de["table.selectRow"], { row: selection.rowLabel?.(row) ?? key })}</span>} checked={selection.selected.has(key)} onCheckedChange={(on) => toggle(key, on)} />
                  </td>
                )}
                {columns.map((c) => <td key={c.key} className={num(c)}>{c.cell(row)}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
  if (!selection) return table;
  return (
    <>
      <p className="g-tbl__count" role="status" aria-live="polite">{fill(de["table.selected"], { n: picked })}</p>
      {table}
    </>
  );
}
