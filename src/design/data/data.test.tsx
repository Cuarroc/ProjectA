import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HonestState, type HonestKind } from "./HonestState";
import { KeyValue } from "./KeyValue";
import { ProofChip } from "./ProofChip";
import { Table } from "./Table";

const css = readFileSync(resolve(__dirname, "data.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const tokens = readFileSync(resolve(__dirname, "../tokens.css"), "utf8");

describe("Table", () => {
  const rows = [{ id: "a", name: "Alpha", n: 7 }, { id: "b", name: "Beta", n: 12 }];
  const columns = [
    { key: "name", header: "Name", cell: (r: (typeof rows)[number]) => r.name },
    { key: "n", header: "Count", numeric: true, cell: (r: (typeof rows)[number]) => r.n },
  ];

  it("is a focusable labelled region with column headers and one row per key", () => {
    render(<Table label="Agents" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const region = screen.getByRole("region", { name: "Agents" });
    expect(region.tabIndex).toBe(0);
    const table = within(region).getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Name", "Count"]);
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByRole("cell", { name: "12" })).toHaveClass("g-tbl__n");
  });

  it("shows no table at all for zero rows and defers to the empty slot", () => {
    render(<Table label="Agents" columns={columns} rows={[]} rowKey={(r: (typeof rows)[number]) => r.id} empty={<p>Nothing</p>} />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("Nothing")).toBeInTheDocument();
  });
});

describe("KeyValue", () => {
  it("pairs each term with its definition and titles text that may be cut off", () => {
    const { container } = render(<KeyValue box items={[{ label: "Branch", value: "claude/v2-f5b-data" }, { label: "Size", value: <b>M</b> }]} />);
    expect(container.querySelectorAll("dt")).toHaveLength(2);
    expect(container.querySelector("dd")).toHaveAttribute("title", "claude/v2-f5b-data");
    expect(container.querySelectorAll("dd")[1]).not.toHaveAttribute("title");
    expect(container.firstElementChild).toHaveClass("g-kv", "g-kv--box");
  });
});

describe("ProofChip", () => {
  it("counts the passed gates in words and hides the ticks from assistive tech", () => {
    const { container } = render(<ProofChip gates={["pass", "pass", "wip", "none"]} verdict={{ tone: "wip", text: "Review läuft" }} />);
    expect(screen.getByText("Gates 2/4")).toBeInTheDocument();
    expect(screen.getByText("Review läuft")).toHaveClass("g-proof__wip");
    expect(container.querySelector(".g-proof__ticks")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelectorAll(".g-proof__ticks i.g-proof__t--pass")).toHaveLength(2);
  });

  it("becomes a link with a seven-character commit when it has a target", () => {
    render(<ProofChip gates={["pass", "fail"]} href="#proof" sha="7c1e0b3a9f" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "#proof");
    expect(link).toHaveTextContent("Gates 1/2");
    expect(within(link).getByText("7c1e0b3")).toBeInTheDocument();
  });
});

describe("HonestState", () => {
  const kinds: HonestKind[] = ["empty", "offline", "locked"];

  it("has its own word and shape per kind", () => {
    const words = kinds.map((kind) => {
      const { container, unmount } = render(<HonestState kind={kind} />);
      const word = container.querySelector(".g-hs__title")?.textContent;
      expect(container.firstElementChild).toHaveClass(`g-hs--${kind}`);
      unmount();
      return word;
    });
    expect(new Set(words).size).toBe(3);
  });

  it("never shows a digit from title or hint or action label", () => {
    for (const kind of kinds) {
      const onClick = vi.fn();
      const { container, unmount } = render(
        <HonestState kind={kind} title="0 Treffer" hint="Nach 3 Läufen" action={{ label: "Noch 5 Versuche", onClick }} />,
      );
      expect(container.textContent).not.toMatch(/\d/);
      expect(screen.queryByRole("button")).toBeNull();
      unmount();
    }
  });

  it("keeps clean text and a working action", () => {
    const onClick = vi.fn();
    render(<HonestState kind="offline" title="Kein Anbieter" hint="Anmelden, dann erscheint hier etwas." action={{ label: "Anmelden", onClick }} />);
    expect(screen.getByText("Kein Anbieter")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Anmelden" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("data.css", () => {
  it("uses only tokens that tokens.css defines", () => {
    const used = new Set(Array.from(css.matchAll(/var\((--g-[\w-]+)/g), (m) => m[1]));
    expect([...used].filter((n) => !tokens.includes(`${n}:`))).toEqual([]);
  });

  it("paints the content surface under tables and the empty state and never bare glass", () => {
    for (const sel of [".g-tw", ".g-hs"]) {
      const bodies = css.split("}").filter((r) => r.split("{")[0].split(",").some((s) => s.trim() === sel)).join(";");
      expect(bodies, sel).toMatch(/background:\s*var\(--g-content-bg\)/);
      expect(bodies, sel).not.toMatch(/backdrop-filter/);
    }
  });
});
