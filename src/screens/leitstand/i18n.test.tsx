import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { catalogs, de } from "../../i18n/de";
import type { QuestionsState } from "../../lib/useQuestions";
import type { Question } from "../../types";
import { LeitstandCards } from "./LeitstandCards";
import { LeitstandTabs } from "./LeitstandRoute";
import { ageText } from "./leitstand";
import { NeedsYou } from "./needs/NeedsYou";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

/** Swaps single dictionary entries; keys that do not exist yet make the override a no-op. */
const override = (words: Record<string, string>) => {
  catalogs.de = { ...de, ...words } as typeof de;
};
const questions = (open: Question[]): QuestionsState => ({
  open, history: [], loading: false, error: null, scope: "project", setScope: () => {}, refresh: async () => {}, answer: async () => {},
});

afterEach(() => {
  cleanup();
  catalogs.de = de;
});

it("Leitstand cards read their words from the dictionary", () => {
  override({ "leitstand.emptyTitle": "Words from the catalog" });
  render(<LeitstandCards cards={[]} profiles={[]} now={0} onOpen={() => {}} />);
  expect(screen.getByText("Words from the catalog")).toBeInTheDocument();
});

it("Leitstand route frame reads its words from the dictionary", () => {
  override({ "leitstand.tabs": "Tabs from the catalog" });
  render(<LeitstandTabs path="/leitstand" />);
  expect(screen.getByRole("navigation", { name: "Tabs from the catalog" })).toBeInTheDocument();
});

it("Braucht dich reads its words from the dictionary", () => {
  override({ "needs.emptyTitle": "Needs words from the catalog" });
  render(<NeedsYou questions={questions([])} workers={[]} />);
  expect(screen.getByText("Needs words from the catalog")).toBeInTheDocument();
});

it("age texts fill the dictionary templates", () => {
  override({ "leitstand.since": "ago {age}", "leitstand.min": "{n} m" });
  expect(ageText(0, 38 * 60)).toBe("ago 38 m");
});
