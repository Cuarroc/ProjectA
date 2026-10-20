import { cleanup, render, screen, within, fireEvent } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ChartFrame } from "./ChartFrame";
import { Sparkline } from "./Sparkline";
import { BarList } from "./BarList";

afterEach(cleanup);
const data = [{ label: "Mo", value: -2 }, { label: "Di", value: 0 }, { label: "Mi", value: 4 }];

it("the table twin shows the same values as the chart", () => {
  render(<ChartFrame title="Aufträge" caption="Diese Woche" kind="bars" data={data} />);
  expect(screen.getByRole("heading", { name: "Aufträge" })).toBeTruthy();
  expect(screen.getByText("Diese Woche")).toBeTruthy();
  const table = screen.getByRole("table", { name: "Aufträge" });
  expect(within(table).getAllByRole("row").map(row => row.textContent)).toEqual(["BezeichnungWert", "Mo-2", "Di0", "Mi4"]);
  expect(screen.getByRole("list", { name: "Aufträge" }).textContent).toBe("Mo-2Di0Mi4");
  expect(screen.getByRole("list", { name: "Legende" }).textContent).toBe("MoDiMi");
});

it("the table disclosure opens only after clicking its summary", () => {
  render(<ChartFrame title="Aufträge" caption="Diese Woche" kind="bars" data={data} />);
  const summary = screen.getByText("Als Tabelle");
  const details = summary.closest("details")!;
  expect(details.open).toBe(false);
  summary.focus();
  expect(document.activeElement).toBe(summary);
  fireEvent.click(summary);
  expect(details.open).toBe(true);
});

it("bars and table twins format fractions and thousands in German", () => {
  render(<ChartFrame title="Messung" caption="Dezimalwerte" kind="bars" data={[{ label: "A", value: 1234.5 }, { label: "B", value: 0.1 + 0.2 }]} />);
  const table = screen.getByRole("table", { name: "Messung" });
  expect(within(table).getAllByRole("cell").map(cell => cell.textContent)).toEqual(["1.234,5", "0,3"]);
  expect(screen.getByRole("list", { name: "Messung" }).textContent).toBe("A1.234,5B0,3");
});

it("each bar has a text label and value beyond colour", () => {
  const { container } = render(<BarList label="Messung" data={[...data, { label: "Do", value: NaN }]} />);
  expect(screen.getByRole("list", { name: "Messung" }).textContent).toBe("Mo-2Di0Mi4DoUnbekannt");
  const rects = container.querySelectorAll("rect");
  expect([...rects].map(r => [r.getAttribute("x"), r.getAttribute("width")])).toEqual([["26", "24"], ["50", "0"], ["50", "48"]]);
});

it("sparkline preserves gaps and renders single and constant samples", () => {
  const { container, rerender } = render(<Sparkline label="Verlauf" data={[{ label: "A", value: 1 }, { label: "B", value: null }, { label: "C", value: 3 }]} />);
  expect(screen.getByRole("img", { name: "Verlauf" })).toBeTruthy();
  expect(container.querySelector("path")?.getAttribute("d")).toBe("M2,30 M118,2");
  for (const values of [[0], [2, 2], [-Number.MAX_VALUE, Number.MAX_VALUE]]) {
    rerender(<Sparkline label="Verlauf" data={values.map((value, i) => ({ label: String(i), value }))} />);
    expect(container.querySelectorAll("circle")).toHaveLength(values.length);
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  }
});

it("empty and unknown data are words in graphics and table twins", () => {
  for (const kind of ["sparkline", "bars"] as const) {
    for (const [data, word] of [[[], "Keine Daten"], [null, "Unbekannt"], [[{ label: "Mo", value: Infinity }], "Unbekannt"]] as const) {
      const { unmount } = render(<ChartFrame title="Messung" caption="Beispiel" kind={kind} data={data} />);
      expect(screen.getAllByText(word).length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText("Als Tabelle").tagName).toBe("SUMMARY");
      expect(screen.queryByRole("list", { name: "Legende" }) !== null).toBe(Boolean(data?.length));
      unmount();
    }
  }
});
