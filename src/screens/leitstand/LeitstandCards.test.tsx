import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { invoke } from "@tauri-apps/api/core";
import { getBoardState } from "../../lib/ipc";
import type { AgentProfile, BoardCard } from "../../types";
import { LeitstandCards } from "./LeitstandCards";
import { cardLamp } from "./lamps/lampFor";
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

  view.rerender(<LeitstandCards {...props} />);
  const renamed = [{ ...profiles[0]!, name: "Renamed fixture" }];
  view.rerender(<LeitstandCards {...props} profiles={renamed} />);
  expect(screen.getByRole("heading", { name: "Renamed fixture" })).toBeInTheDocument();
  view.rerender(<LeitstandCards {...props} profiles={renamed} now={NOW + 60} />);
  expect(screen.getByText("seit 39 min")).toBeInTheDocument();
});

it("derives forms and counts from the real get_board_state shape and leaves coordinators out", async () => {
  const list = agentCards(await cards());
  expect(list.map((c) => c.worker.id)).toEqual(["w1", "w2", "w3"]);
  expect(list.map(cardForm)).toEqual(["run", "need", "bad"]);
  // The cards and their chips use the lamp form; on this shape it equals the column form of the org chart.
  const formOf = (c: BoardCard) => cardLamp(c, NOW).form;
  expect(list.map(formOf)).toEqual(["run", "need", "bad"]);
  expect(countByFilter(list, formOf)).toMatchObject({ all: 3, run: 1, need: 1, rev: 0, ok: 0, done: 0, bad: 1 });
});

it("shows one card per agent with its proof strip and filters by state", async () => {
  render(<LeitstandCards cards={await cards()} profiles={profiles} now={NOW} onOpen={() => {}} />);
  const list = screen.getByRole("region", { name: "Agenten" });
  expect(within(list).getAllByRole("article")).toHaveLength(3);
  expect(within(list).getAllByRole("group", { name: "Beweis" })).toHaveLength(3);
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

it("announces the empty filter result as a status that names the filter", async () => {
  render(<LeitstandCards cards={await cards()} profiles={profiles} now={NOW} onOpen={() => {}} />);
  expect(screen.getByRole("status")).toBeEmptyDOMElement();
  fireEvent.click(screen.getByRole("button", { name: /^In Prüfung/ }));
  expect(screen.getByRole("status")).toHaveTextContent("Kein Agent im Zustand In Prüfung.");
  fireEvent.click(screen.getByRole("button", { name: "Alle zeigen" }));
  expect(screen.getByRole("status")).toBeEmptyDOMElement();
});

it("changes the status text when switching from one empty filter to another", async () => {
  render(<LeitstandCards cards={await cards()} profiles={profiles} now={NOW} onOpen={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /^In Prüfung/ }));
  const region = screen.getByRole("status");
  expect(region).toHaveTextContent("Kein Agent im Zustand In Prüfung.");
  fireEvent.click(screen.getByRole("button", { name: /^Bereit zum Mergen/ }));
  // A live region announces a change of text, so the same node must now say something different.
  expect(screen.getByRole("status")).toBe(region);
  expect(region).toHaveTextContent("Kein Agent im Zustand Bereit zum Mergen.");
  expect(region).not.toHaveTextContent("In Prüfung");
});

it("the proof strip is a direct child of each card, above the foot", async () => {
  const { container } = render(<LeitstandCards cards={await cards()} profiles={profiles} now={NOW} onOpen={() => {}} />);
  expect(container.querySelectorAll(".ls-card > .ps + .ls-foot")).toHaveLength(3);
});

it("filter chips count the same form the cards show", async () => {
  vi.mocked(invoke).mockResolvedValue({
    cards: [
      { worker: worker("b1"), column: "needs_you", attention_code: "agent_reported", attention_grade: "blocking" },
      { worker: worker("i1", { status: "exited" }), column: "working" },
      { worker: worker("d1"), column: "done", test_status: null },
      { worker: worker("r1"), column: "working" },
    ],
    coordinators: [],
  });
  const list = (await getBoardState("p1")).cards;
  render(<LeitstandCards cards={list} profiles={profiles} now={NOW} onOpen={() => {}} />);
  const region = screen.getByRole("region", { name: "Agenten" });
  // The blocked, the idle and the done-without-proof card all carry the "need" mark.
  expect(screen.getByRole("button", { name: /^Braucht dich/ })).toHaveTextContent("3");
  expect(screen.getByRole("button", { name: /^Läuft/ })).toHaveTextContent("1");
  fireEvent.click(screen.getByRole("button", { name: /^Braucht dich/ }));
  expect(within(region).getAllByRole("article")).toHaveLength(3);
  for (const article of within(region).getAllByRole("article")) expect(article.querySelector(".g-st--need")).not.toBeNull();
});

it("the review and ready and failure chips count their cards", async () => {
  vi.mocked(invoke).mockResolvedValue({
    cards: [
      { worker: worker("v1"), column: "in_review" },
      { worker: worker("m1"), column: "ready_to_merge" },
      { worker: worker("f1"), column: "working", attention_code: "agent_stalled", attention_grade: "blocking" },
    ],
    coordinators: [],
  });
  const list = (await getBoardState("p1")).cards;
  render(<LeitstandCards cards={list} profiles={profiles} now={NOW} onOpen={() => {}} />);
  const region = screen.getByRole("region", { name: "Agenten" });
  for (const [chip, mark] of [["In Prüfung", "rev"], ["Bereit zum Mergen", "ok"], ["Fehler", "bad"]]) {
    expect(screen.getByRole("button", { name: new RegExp(`^${chip}`) })).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${chip}`) }));
    const articles = within(region).getAllByRole("article");
    expect(articles).toHaveLength(1);
    expect(articles[0]!.querySelector(`.g-st--${mark}`)).not.toBeNull();
  }
});
