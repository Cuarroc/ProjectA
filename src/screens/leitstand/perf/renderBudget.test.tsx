import { Profiler, type ProfilerOnRenderCallback } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { AgentProfile, BoardCard } from "../../../types";
import { LeitstandCards } from "../LeitstandCards";
import { boardFixture, NOW, refreshFixture } from "./fixtures";
import budget from "./renderBudget.json";

const counts = vi.hoisted(() => ({ commits: 0, cardRenders: 0, actualDuration: 0 }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

// Transparent instrumentation only: execute the real card, including its hooks and DOM.
// A card render means a committed render of that card's subtree, not an attempted render.
vi.mock("../AgentCard", async (importOriginal) => {
  const { AgentCard } = await importOriginal<typeof import("../AgentCard")>();
  const { Profiler: CardProfiler } = await import("react");
  return {
    AgentCard: (props: React.ComponentProps<typeof AgentCard>) => (
      <CardProfiler id={props.card.worker.id} onRender={() => { counts.cardRenders++; }}>
        <AgentCard {...props} />
      </CardProfiler>
    ),
  };
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const onRender: ProfilerOnRenderCallback = (_id, _phase, actualDuration) => {
  counts.commits++;
  // Only the root duration is summed; nested profiler time must not be counted twice.
  counts.actualDuration += actualDuration;
};
const profiles: AgentProfile[] = [];
const onOpen = () => {};
const tree = (cards: readonly BoardCard[], generation = 0) => (
  <Profiler id="leitstand" onRender={onRender}>
    <LeitstandCards key={generation} cards={cards} profiles={profiles} now={NOW} onOpen={onOpen} />
  </Profiler>
);

function measure(action: () => void) {
  const before = { ...counts };
  action();
  return {
    commits: counts.commits - before.commits,
    cardRenders: counts.cardRenders - before.cardRenders,
    actualDuration: counts.actualDuration - before.actualDuration,
  };
}

it("render counts stay within the leitstand budget", () => {
  const cards = boardFixture();
  const refreshed = refreshFixture(cards);
  expect(refreshed.filter((card, index) => card !== cards[index])).toHaveLength(1);
  let view: ReturnType<typeof render>;
  const mount = measure(() => { view = render(tree(cards)); });
  expect(screen.getAllByRole("article")).toHaveLength(40);
  const refresh = measure(() => { view.rerender(tree(refreshed)); });
  expect(screen.getByRole("button", { name: "fixture-profile-0 neu starten" })).toBeInTheDocument();
  const filter = measure(() => {
    fireEvent.click(screen.getByRole("button", { name: /^Läuft/ }));
  });
  // The chip counts the form the mark shows: the 19 running cards in "working" and the 20 running ones in review all read "run".
  expect(screen.getAllByRole("article")).toHaveLength(39);
  expect(screen.getByRole("button", { name: /^Läuft/ })).toHaveAttribute("aria-pressed", "true");
  cleanup();

  // Deliberately bad implementation of ONE refresh: ten redundant full remounts.
  // Remount alone need not increase counts when the baseline already renders every card.
  const degradedView = render(tree(cards));
  const degraded = measure(() => {
    for (let generation = 1; generation <= 10; generation++) {
      degradedView.rerender(tree(refreshed, generation));
    }
  });
  expect(screen.getAllByRole("article")).toHaveLength(40);
  expect(degraded.commits).toBeGreaterThan(refresh.commits);
  expect(degraded.cardRenders).toBeGreaterThan(refresh.cardRenders);
  expect(invoke).not.toHaveBeenCalled();

  const measurements = { mount, refresh, filter };
  console.info("render-budget counts", JSON.stringify(Object.fromEntries(
    Object.entries(measurements).map(([name, { commits, cardRenders }]) => [name, { commits, cardRenders }]),
  )));
  // Directional evidence for the report only: duration is never a pass/fail threshold.
  console.info("render-budget correlation", JSON.stringify({ refresh, degraded }));
  for (const name of ["mount", "refresh", "filter"] as const) {
    for (const metric of ["commits", "cardRenders"] as const) {
      const actual = measurements[name][metric];
      const ceiling = budget.ceilings[name][metric];
      expect.soft(actual, `${name}.${metric}: actual=${actual}, ceiling=${ceiling}`).toBeLessThanOrEqual(ceiling);
      if (actual < ceiling) console.info(`Lower render budget: ${name}.${metric} ${ceiling} -> ${actual}`);
    }
  }
});
