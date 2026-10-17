import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";

import { Table } from "./Table";

const css = readFileSync(resolve(__dirname, "data.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const rows = [{ id: "b", name: "Beta", n: 12 }, { id: "a", name: "Alpha", n: 7 }, { id: "c", name: "Gamma", n: 30 }];
type Row = (typeof rows)[number];
const columns = [
  { key: "name", header: "Name", sortValue: (r: Row) => r.name, cell: (r: Row) => r.name },
  { key: "n", header: "Count", numeric: true, sortValue: (r: Row) => r.n, cell: (r: Row) => r.n },
  { key: "plain", header: "Plain", cell: () => "-" },
];
const names = () => screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent);

it("cycles aria-sort from none to ascending to descending by keyboard", () => {
  render(<Table label="Agents" columns={columns} rows={rows} rowKey={(r) => r.id} />);
  const th = screen.getByRole("columnheader", { name: "Name" });
  const button = within(th).getByRole("button", { name: "Name" });
  expect(th).toHaveAttribute("aria-sort", "none");
  expect(names()).toEqual(["Beta", "Alpha", "Gamma"]);
  button.focus();
  // jsdom turns no key into a click, so Enter and Space must be handled on the button itself.
  fireEvent.keyDown(button, { key: "Enter" });
  expect(th).toHaveAttribute("aria-sort", "ascending");
  expect(names()).toEqual(["Alpha", "Beta", "Gamma"]);
  fireEvent.keyDown(button, { key: " " });
  expect(th).toHaveAttribute("aria-sort", "descending");
  expect(names()).toEqual(["Gamma", "Beta", "Alpha"]);
  fireEvent.click(button);
  expect(th).toHaveAttribute("aria-sort", "none");
  expect(names()).toEqual(["Beta", "Alpha", "Gamma"]);
});

it("sorts one column at a time and compares numbers numerically", () => {
  render(<Table label="Agents" columns={columns} rows={rows} rowKey={(r) => r.id} />);
  fireEvent.click(screen.getByRole("button", { name: "Name" }));
  fireEvent.click(screen.getByRole("button", { name: "Count" }));
  expect(screen.getByRole("columnheader", { name: "Name" })).toHaveAttribute("aria-sort", "none");
  expect(screen.getByRole("columnheader", { name: "Count" })).toHaveAttribute("aria-sort", "ascending");
  expect(names()).toEqual(["Alpha", "Beta", "Gamma"]);
  expect(screen.getByRole("columnheader", { name: "Plain" })).not.toHaveAttribute("aria-sort");
  expect(screen.queryByRole("button", { name: "Plain" })).toBeNull();
});

it("renders the empty slot text through HonestState and the loading slot instead of the table", () => {
  const { rerender } = render(<Table label="Agents" columns={columns} rows={[]} rowKey={(r: Row) => r.id} empty="Keine Agenten" />);
  expect(screen.getByText("Keine Agenten")).toHaveClass("g-hs__title");
  expect(screen.queryByRole("table")).toBeNull();
  rerender(<Table label="Agents" columns={columns} rows={rows} rowKey={(r) => r.id} loading />);
  expect(screen.getByRole("status")).toHaveTextContent("Lädt …");
  expect(screen.queryByRole("table")).toBeNull();
});

it("keeps the header sticky inside the scroll region", () => {
  expect(css).toMatch(/\.g-tbl th\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0/);
});
