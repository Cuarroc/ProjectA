import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it } from "vitest";

import { Table } from "./Table";

const rows = [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }, { id: "c", name: "Gamma" }];
type Row = (typeof rows)[number];
const columns = [{ key: "name", header: "Name", cell: (r: Row) => r.name }];

function Harness() {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  return <Table label="Agents" columns={columns} rows={rows} rowKey={(r) => r.id} selection={{ selected, onChange: setSelected, rowLabel: (r) => r.name }} />;
}

it("selection announces count", () => {
  render(<Harness />);
  const live = screen.getByRole("status");
  expect(live).toHaveAttribute("aria-live", "polite");
  expect(live).toHaveTextContent("0 ausgewählt");
  fireEvent.click(screen.getByRole("checkbox", { name: "Zeile auswählen: Alpha" }));
  expect(live).toHaveTextContent("1 ausgewählt");
  expect(screen.getByRole("checkbox", { name: "Alle Zeilen auswählen" })).toBePartiallyChecked();
  fireEvent.click(screen.getByRole("checkbox", { name: "Alle Zeilen auswählen" }));
  expect(live).toHaveTextContent("3 ausgewählt");
  expect(screen.getByRole("checkbox", { name: "Alle Zeilen auswählen" })).toBeChecked();
  fireEvent.click(screen.getByRole("checkbox", { name: "Alle Zeilen auswählen" }));
  expect(live).toHaveTextContent("0 ausgewählt");
  expect(screen.getAllByRole("row")[1]).not.toHaveAttribute("aria-selected", "true");
});

it("marks selected rows with aria-selected", () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Zeile auswählen: Beta" }));
  expect(screen.getAllByRole("row")[2]).toHaveAttribute("aria-selected", "true");
  expect(screen.getAllByRole("row")[1]).toHaveAttribute("aria-selected", "false");
});

it("renders no checkboxes or live region without a selection prop", () => {
  render(<Table label="Agents" columns={columns} rows={rows} rowKey={(r) => r.id} />);
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
});
