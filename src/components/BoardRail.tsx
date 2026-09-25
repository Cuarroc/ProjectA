import { useMemo } from "react";

import {
  BOARD_COLUMNS,
  COLUMN_LABELS,
  columnStateClass,
  isCoordinatorKind,
  kindIcon,
} from "../lib/board";
import { shortTask } from "../lib/text";
import type { BoardCard, Worker } from "../types";

interface BoardRailProps {
  cards: BoardCard[];
  /** Worker whose terminal tab is currently in front, if any. */
  activeWorkerId: string | null;
  hasProject: boolean;
  loading: boolean;
  error: string | null;
  /** Open the worker's workspace, same jump a board card makes. */
  onOpen: (worker: Worker) => void;
  /** Leave the rail for the full board, where a card can be acted on. */
  onOpenBoard: () => void;
  /** Open questions in the Fragen view's scope; the rail counts them, nothing more. */
  openQuestions: number;
  /** Whether that count covers every project rather than only this one. */
  questionsFleetWide: boolean;
  /**
   * Leave the rail for the questions view. This is the jump that pays: an open
   * question already shows up here as an attention reason, but 236 px cut it
   * after a few words, and the decision is in the part that was cut.
   */
  onOpenQuestions: () => void;
  onCollapse: () => void;
}

/**
 * The board, reduced to what fits beside a conversation: one line per worker,
 * grouped by column, attention first.
 *
 * It deliberately carries no actions. Merging, moving, running tests and
 * reading a diff all stay on the full board — a rail that tried to reproduce
 * them would be a second board in a quarter of the width. What it owes the
 * user is the answer to "is anything waiting for me", at a glance, without
 * leaving the dialog.
 */
export default function BoardRail({
  cards,
  activeWorkerId,
  hasProject,
  loading,
  error,
  onOpen,
  onOpenBoard,
  openQuestions,
  questionsFleetWide,
  onOpenQuestions,
  onCollapse,
}: BoardRailProps) {
  // Coordinators hold no task of their own; the board banner is their place,
  // and a rail entry for them would only be an empty seat with a name.
  const workerCards = useMemo(
    () => cards.filter((card) => !isCoordinatorKind(card.worker.kind)),
    [cards],
  );

  const groups = useMemo(
    () =>
      BOARD_COLUMNS.map((column) => ({
        column,
        cards: workerCards.filter((card) => card.column === column),
      })).filter((group) => group.cards.length > 0),
    [workerCards],
  );

  const needsYou = workerCards.filter((card) => card.column === "needs_you").length;

  return (
    <aside className="rail" aria-label="Board">
      <div className="rail-head">
        <button
          type="button"
          className="rail-title"
          onClick={onOpenBoard}
          title="Ganzes Board öffnen"
        >
          Board
        </button>
        {needsYou > 0 ? (
          <span
            className={`state-chip ${columnStateClass("needs_you")}`}
            title={`${needsYou} Worker warten auf dich`}
          >
            {needsYou}
          </span>
        ) : null}
        {openQuestions > 0 ? (
          <button
            type="button"
            className={`state-chip rail-questions ${columnStateClass("needs_you")}`}
            onClick={onOpenQuestions}
            aria-label={`${openQuestions} offene ${openQuestions === 1 ? "Frage" : "Fragen"}`}
            title={`${openQuestions} offene ${openQuestions === 1 ? "Frage" : "Fragen"} ${
              questionsFleetWide ? "in allen Projekten" : "in diesem Projekt"
            } — hier steht nur die Zahl, der Text steht in der Fragen-Ansicht`}
          >
            ? {openQuestions}
          </button>
        ) : null}
        <button
          type="button"
          className="rail-collapse"
          onClick={onCollapse}
          title="Leiste einklappen"
          aria-label="Leiste einklappen"
        >
          ‹
        </button>
      </div>
      <div className="rail-body">
        {error ? <p className="rail-note rail-note-error">{error}</p> : null}
        {!hasProject ? (
          <p className="rail-note">Kein Projekt aktiv.</p>
        ) : loading && workerCards.length === 0 ? (
          <p className="rail-note">Lädt …</p>
        ) : workerCards.length === 0 ? (
          <p className="rail-note">Noch keine Worker.</p>
        ) : (
          groups.map((group) => (
            <section key={group.column} className={`rail-group ${columnStateClass(group.column)}`}>
              <h2 className="rail-label">
                {COLUMN_LABELS[group.column]} · {group.cards.length}
              </h2>
              {group.cards.map((card) => {
                const icon = kindIcon(card.worker.kind);
                // Attention has a reason worth reading; everything else is
                // better described by the task it is working on.
                const sub = card.attentionReason ?? shortTask(card.worker.task);
                return (
                  <button
                    key={card.worker.id}
                    type="button"
                    className={`rail-item${
                      card.attentionReason !== null ? " rail-item-attention" : ""
                    }${card.worker.id === activeWorkerId ? " rail-item-active" : ""}`}
                    onClick={() => onOpen(card.worker)}
                    // The sub line is cut to one line of 236 px, so an
                    // attention reason is regularly unreadable there. The
                    // tooltip is not the fix — the Fragen view is — but it
                    // costs nothing to carry the whole sentence here.
                    title={
                      card.attentionReason !== null
                        ? `${card.worker.branch} — ${card.attentionReason}`
                        : `${card.worker.branch} — ${card.worker.task}`
                    }
                  >
                    <span className="rail-item-name">
                      {icon === "" ? null : <span aria-hidden="true">{icon} </span>}
                      {card.worker.branch}
                    </span>
                    <span className="rail-item-sub">{sub}</span>
                  </button>
                );
              })}
            </section>
          ))
        )}
      </div>
    </aside>
  );
}
