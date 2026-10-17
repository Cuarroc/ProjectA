import type { ReactNode } from "react";
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

export function Table<Row>({ label, columns, rows, rowKey, empty }: TableProps<Row>) {
  if (rows.length === 0) {
    if (empty) return <>{empty}</>;
    return null;
  }
  const num = (c: Column<Row>) => (c.numeric ? "g-tbl__n" : undefined);
  return (
    <div className="g-tw" role="region" aria-label={label} tabIndex={0}>
      <table className="g-tbl">
        <thead>
          <tr>{columns.map((c) => <th key={c.key} scope="col" className={num(c)}>{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>{columns.map((c) => <td key={c.key} className={num(c)}>{c.cell(row)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
