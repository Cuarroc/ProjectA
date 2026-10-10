import { isCoordinatorKind } from "../../lib/board";
import type { BoardCard } from "../../types";
import { formForColumn, formForReason, STATE_FORMS, type StateForm } from "../../design/state/states";
import { T } from "./texts";

export type Filter = "all" | StateForm;

/** Coordinators live in the shell banner, not on a card (same rule as BoardView). */
export const agentCards = (cards: readonly BoardCard[]) => cards.filter((c) => !isCoordinatorKind(c.worker.kind));

/** The column gives the form; a failure reason (`bad`) wins because it has no column. */
export function cardForm(card: BoardCard): StateForm {
  return formForReason(card.attentionCode ?? "") === "bad" ? "bad" : formForColumn(card.column);
}

/** Zero is a real count, so every chip gets a number. */
export function countByFilter(cards: readonly BoardCard[]): Record<Filter, number> {
  const counts = { all: cards.length } as Record<Filter, number>;
  for (const form of STATE_FORMS) counts[form] = cards.filter((c) => cardForm(c) === form).length;
  return counts;
}

export function ageText(createdAt: number, now: number): string {
  const min = Math.max(0, Math.floor((now - createdAt) / 60));
  if (min < 1) return T.justNow;
  if (min < 60) return T.since(T.min(min));
  return T.since(min < 1440 ? T.hours(Math.floor(min / 60)) : T.days(Math.floor(min / 1440)));
}

export const initials = (name: string) =>
  name.split(/[\s\-_]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

/** A stable avatar tone 1..6 per profile, so one agent keeps its colour. */
export const toneFor = (id: string) => ([...id].reduce((h, c) => h + c.charCodeAt(0), 0) % 6 + 1) as 1 | 2 | 3 | 4 | 5 | 6;
