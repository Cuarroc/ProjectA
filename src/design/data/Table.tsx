import type { ReactNode } from "react";
import "./data.css";

export interface Column<Row> {
  key: string;
  header: string;
  numeric?: boolean;
  cell: (row: Row) => ReactNode;
}

export interface TableProps<Row> {
  /** Accessible name of the scroll region; also names the table. */
  label: string;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** Shown instead of the table for zero rows (use HonestState). */
  empty?: ReactNode;
}

export function Table<Row>({ label, columns, rows, rowKey, empty }: TableProps<Row>) {
  if (rows.length === 0 && empty) return <>{empty}</>;
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
