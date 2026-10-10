import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Sheet } from "./Sheet";
import { TabPanel, Tabs } from "./Tabs";
import { ToastRegion } from "./Toast";

const css = readFileSync(resolve(__dirname, "layout.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const tokens = readFileSync(resolve(__dirname, "../tokens.css"), "utf8");

describe("Tabs", () => {
  const tabs = [{ id: "a", label: "Quota" }, { id: "b", label: "Verlauf" }, { id: "c", label: "Kosten" }] as const;
  const Harness = () => {
    const [v, setV] = useState<"a" | "b" | "c">("a");
    return (
      <>
        <Tabs idBase="k" aria-label="Bereiche" tabs={tabs} value={v} onChange={setV} />
        {tabs.map((t) => <TabPanel key={t.id} idBase="k" id={t.id} active={v === t.id}>Inhalt {t.id}</TabPanel>)}
      </>
    );
  };

  it("wires tab and tabpanel by id and has one tab stop", () => {
    render(<Harness />);
    const items = screen.getAllByRole("tab");
    expect(items.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("aria-labelledby", items[0].id);
    expect(items[0]).toHaveAttribute("aria-controls", panel.id);
  });

  it("moves selection and focus with arrows and wraps and jumps with End", () => {
    render(<Harness />);
    const items = screen.getAllByRole("tab");
    fireEvent.keyDown(items[0], { key: "ArrowLeft" });
    expect(items[2]).toHaveAttribute("aria-selected", "true");
    expect(items[2]).toHaveFocus();
    expect(screen.getByText("Inhalt c")).toBeInTheDocument();
    fireEvent.keyDown(items[2], { key: "ArrowRight" });
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0], { key: "End" });
    expect(items[2]).toHaveFocus();
  });

  it("jumps to the first tab with Home", () => {
    render(<Harness />);
    const items = screen.getAllByRole("tab");
    fireEvent.keyDown(items[0], { key: "End" });
    fireEvent.keyDown(items[2], { key: "Home" });
    expect(items[0]).toHaveFocus();
    expect(items[0]).toHaveAttribute("aria-selected", "true");
  });
});

describe("Sheet", () => {
  const Harness = () => {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Öffnen</button>
        <Sheet open={open} onClose={() => setOpen(false)} aria-label="Agent starten">
          <button>Eins</button>
          <button>Zwei</button>
        </Sheet>
      </>
    );
  };

  it("is modal and takes focus in and traps Tab and closes on Esc and returns focus to the opener", () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Öffnen" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Agent starten" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const one = screen.getByRole("button", { name: "Eins" });
    const two = screen.getByRole("button", { name: "Zwei" });
    expect(one).toHaveFocus();
    fireEvent.keyDown(one, { key: "Tab", shiftKey: true });
    expect(two).toHaveFocus();
    fireEvent.keyDown(two, { key: "Tab" });
    expect(one).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("closes on a scrim mousedown but not on a mousedown inside the sheet", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Öffnen" }));
    const dialog = screen.getByRole("dialog", { name: "Agent starten" });
    fireEvent.mouseDown(screen.getByRole("button", { name: "Eins" }));
    fireEvent.mouseDown(dialog);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Toast", () => {
  afterEach(() => vi.useRealTimers());

  it("announces an error as alert and closes by button and closes itself after the ttl", () => {
    vi.useFakeTimers();
    const Harness = () => {
      const [list, setList] = useState([{ id: 1, text: "Fehler beim Start", tone: "bad" as const }, { id: 2, text: "Gespeichert", tone: "ok" as const }]);
      return <ToastRegion toasts={list} ttl={1000} onDismiss={(id) => setList((l) => l.filter((t) => t.id !== id))} />;
    };
    render(<Harness />);
    expect(screen.getByRole("alert")).toHaveTextContent("Fehler beim Start");
    fireEvent.click(screen.getAllByRole("button", { name: "Schließen" })[0]);
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps the countdown of a toast when another toast is added and the callback identity changes", () => {
    vi.useFakeTimers();
    const Harness = () => {
      const [list, setList] = useState([{ id: 1, text: "Erste", tone: "ok" as const }]);
      return (
        <>
          <button onClick={() => setList((l) => [...l, { id: 2, text: "Zweite", tone: "ok" as const }])}>Neu</button>
          <ToastRegion toasts={list} ttl={1000} onDismiss={(id) => setList((l) => l.filter((t) => t.id !== id))} />
        </>
      );
    };
    render(<Harness />);
    act(() => { vi.advanceTimersByTime(600); });
    fireEvent.click(screen.getByRole("button", { name: "Neu" }));
    expect(screen.getByText("Zweite")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.queryByText("Erste")).toBeNull();
    expect(screen.getByText("Zweite")).toBeInTheDocument();
  });
});

describe("layout.css", () => {
  it("uses only defined tokens and no shadow on the selected tab and no animation for reduced motion", () => {
    const used = new Set(Array.from(css.matchAll(/var\((--g-[\w-]+)/g), (m) => m[1]));
    expect([...used].filter((n) => !tokens.includes(`${n}:`) && !/^--g-(dur-1|dur-2|ease)$/.test(n))).toEqual([]);
    const selected = /\.g-tabs button\[aria-selected="true"\]\s*\{([^}]*)\}/.exec(css);
    expect(selected).not.toBeNull();
    expect(selected?.[1]).not.toMatch(/box-shadow|filter|gradient/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce\)\s*\{[^@]*\.g-sheet[^}]*animation:\s*none/);
  });
});
