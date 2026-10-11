import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { invoke } from "@tauri-apps/api/core";
import { getBoardState } from "../../lib/ipc";
import type { AgentProfile, BoardCard } from "../../types";
import { LeitstandCards } from "./LeitstandCards";
import { agentCards, cardForm, countByFilter } from "./leitstand";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const NOW = 1_760_000_000;
const worker = (id: string, extra: Record<string, unknown> = {}) => ({
  id, projectId: "p1", task: `Task ${id}`, profileId: "claude", branch: `claude/${id}`, worktreePath: "wt",
  sessionId: null, status: "running", createdAt: NOW - 38 * 60, ...extra,
});
/** The wire shape of `get_board_state` (snake_case card fields, as the Rust core sends them). */
const wire = {
  cards: [
    { worker: worker("w1"), column: "working", attention_reason: null, attention_code: null, attention_grade: null, pr_url: null, context_usage: null, controlled_by: null, test_status: null, tested_at: null },
    { worker: worker("w2"), column: "needs_you", attention_reason: "Fragt", attention_code: "agent_reported", attention_grade: "blocking", pr_url: null },
    { worker: worker("w3"), column: "in_review", attention_reason: "Ausgefallen", attention_code: "agent_exited", attention_grade: "blocking", pr_url: "pr" },
    { worker: worker("w4", { kind: "orchestrator" }), column: "working" },
  ],
  coordinators: [],
};
const profiles = [{ id: "claude", name: "Claude Code" }] as AgentProfile[];

async function cards(): Promise<BoardCard[]> {
  vi.mocked(invoke).mockResolvedValue(wire);
  return (await getBoardState("p1")).cards;
}

beforeEach(() => vi.mocked(invoke).mockReset());

it("a changed card renders its new state and opens the updated data", async () => {
  const initial = (await cards()).slice(0, 1);
  const onOpen = vi.fn();
  const props = { profiles, now: NOW, onOpen };
  const view = render(<LeitstandCards {...props} cards={initial} />);
  expect(screen.getByRole("button", { name: "Claude Code archivieren" })).toBeInTheDocument();
  const updated: BoardCard = {
    ...initial[0]!,
    worker: { ...initial[0]!.worker, status: "exited", task: "Updated fixture task" },
    column: "needs_you",
    attentionReason: "Updated fixture attention",
  };
  view.rerender(<LeitstandCards {...props} cards={[updated]} />);
  expect(screen.queryByRole("button", { name: "Claude Code archivieren" })).toBeNull();
  expect(screen.getByRole("button", { name: "Claude Code neu starten" })).toBeInTheDocument();
  expect(screen.getByText("Updated fixture task")).toBeInTheDocument();
  expect(screen.getByText("Updated fixture attention")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Claude Code öffnen" }));
  expect(onOpen).toHaveBeenCalledWith(updated);
});

it("unchanged card data still receives new display props and action callbacks", async () => {
  const initial = (await cards()).slice(0, 1);
  const onOpen = vi.fn();
  const onChanged = vi.fn();
  const props = { cards: initial, profiles, now: NOW, onOpen, onChanged };
  const view = render(<LeitstandCards {...props} />);
  const nextOpen = vi.fn();
  const nextChanged = vi.fn();
  view.rerender(<LeitstandCards {...props} onOpen={nextOpen} onChanged={nextChanged} />);
  fireEvent.click(screen.getByRole("button", { name: "Claude Code öffnen" }));
  expect(nextOpen).toHaveBeenCalledWith(initial[0]);
  expect(onOpen).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Claude Code archivieren" }));
  fireEvent.click(screen.getByRole("button", { name: "Ja, endgültig archivieren" }));
  await waitFor(() => expect(nextChanged).toHaveBeenCalledTimes(1));
  expect(onChanged).not.toHaveBeenCalled();

  const renamed = [{ ...profiles[0]!, name: "Renamed fixture" }];
  view.rerender(<LeitstandCards {...props} profiles={renamed} />);
  expect(screen.getByRole("heading", { name: "Renamed fixture" })).toBeInTheDocument();
  view.rerender(<LeitstandCards {...props} now={NOW + 60} />);
  expect(screen.getByText("seit 39 min")).toBeInTheDocument();
});

it("derives forms and counts from the real get_board_state shape and leaves coordinators out", async () => {
  const list = agentCards(await cards());
  expect(list.map((c) => c.worker.id)).toEqual(["w1", "w2", "w3"]);
  expect(list.map(cardForm)).toEqual(["run", "need", "bad"]);
  expect(countByFilter(list)).toMatchObject({ all: 3, run: 1, need: 1, rev: 0, ok: 0, done: 0, bad: 1 });
});

it("shows one card per agent with an honest proof slot and filters by state", async () => {
  render(<LeitstandCards cards={await cards()} profiles={profiles} now={NOW} onOpen={() => {}} />);
  const list = screen.getByRole("region", { name: "Agenten" });
  expect(within(list).getAllByRole("article")).toHaveLength(3);
  expect(within(list).getAllByText("Beweis nicht verbunden")).toHaveLength(3);
  expect(within(list).getAllByText("seit 38 min")).toHaveLength(3);
  expect(within(list).getAllByRole("heading", { name: "Claude Code" })).toHaveLength(3);
  expect(screen.getByRole("button", { name: /^In Prüfung/ })).toHaveTextContent("0");
  fireEvent.click(screen.getByRole("button", { name: /^Fehler/ }));
  expect(within(list).getAllByRole("article")).toHaveLength(1);
  expect(screen.getByRole("button", { name: /^Fehler/ })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: /^Erledigt/ }));
  expect(within(list).queryByRole("article")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Alle zeigen" }));
  expect(within(list).getAllByRole("article")).toHaveLength(3);
});

it("tab order is seven chips then open and archive per running card", async () => {
  const onOpen = vi.fn();
  const { container } = render(<LeitstandCards cards={await cards()} profiles={profiles} now={NOW} onOpen={onOpen} />);
  const tabbable = [...container.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), [tabindex]")];
  expect(tabbable.every((el) => el.tabIndex === 0)).toBe(true);
  expect(tabbable.map((el) => el.tagName)).toEqual(Array(13).fill("BUTTON"));
  expect(tabbable.slice(0, 7).map((el) => el.textContent)).toEqual(
    ["Alle 3", "Läuft 1", "Braucht dich 1", "In Prüfung 0", "Bereit zum Mergen 0", "Erledigt 0", "Fehler 1"],
  );
  expect(tabbable.slice(7).map((el) => el.getAttribute("aria-label"))).toEqual(
    ["Claude Code öffnen", "Claude Code archivieren", "Claude Code öffnen", "Claude Code archivieren", "Claude Code öffnen", "Claude Code archivieren"],
  );
  fireEvent.click(tabbable[7]!);
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ worker: expect.objectContaining({ id: "w1" }) }));
});

it("an empty board is said in words and shows no chips", () => {
  render(<LeitstandCards cards={[]} profiles={[]} now={NOW} onOpen={() => {}} />);
  expect(screen.getByText("Noch kein Agent")).toBeInTheDocument();
  expect(screen.queryByRole("group")).toBeNull();
});

it("the offline proof sits in its own scoped slot and no bare HonestState override is left", async () => {
  const { container } = render(<LeitstandCards cards={await cards()} profiles={profiles} now={NOW} onOpen={() => {}} />);
  const slots = container.querySelectorAll(".ls-foot > .ls-proof > .g-hs--offline");
  expect(slots).toHaveLength(3);
  // The override must not reach other HonestState kinds: every rule on `.g-hs` goes through `.ls-proof`.
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "leitstand.css"), "utf8");
  const selectors = css.replace(/\/\*[\s\S]*?\*\//g, "").match(/[^{}]+(?=\{)/g) ?? [];
  expect(selectors.length).toBeGreaterThan(5);
  expect(selectors.filter((sel) => /\.g-hs\b/.test(sel) && !/\.ls-proof\b/.test(sel))).toEqual([]);
  expect(css).not.toMatch(/\.ls-foot\s+\.g-hs/);
});
