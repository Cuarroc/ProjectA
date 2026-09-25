import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";

import { describeError, getBoardState, onWorkerStatus } from "./ipc";
import type { BoardCard, CoordinatorInfo } from "../types";

/**
 * The event is the fast path; this is the safety net for a dropped event or a
 * column that changed while the board was not listening.
 */
const POLL_INTERVAL_MS = 5000;

export interface BoardState {
  cards: BoardCard[];
  /** The project's coordinators, which the board shows above its columns. */
  coordinators: CoordinatorInfo[];
  /**
   * Der Attention-Eintrag je Worker-Id, abgeleitet aus `cards`.
   *
   * Eine Projektion, kein zweiter Zustand: jede Ansicht, die einen einzelnen
   * Agenten zeigt (der Dialog seinen Orchestrator), braucht dessen Eintrag ohne
   * die Kartenliste zu durchsuchen — aber sie darf ihn nicht aus einer eigenen
   * Kopie lesen, die neben den Karten altern kann.
   */
  attentionByWorker: Readonly<Record<string, string | null>>;
  /** Only true for the first fetch of a project — polls stay silent. */
  loading: boolean;
  error: string | null;
  /** Refetch now, e.g. after the user created or archived a worker. */
  refresh: () => void;
}

/**
 * Board state for one project: initial load, `worker:status` updates and a
 * polling fallback. `enabled` turns the polls and the listener off. The sole
 * caller keeps it at `true`: the rail and the status bar's attention count
 * read the cards from every view, so the board no longer sleeps on any single
 * view.
 */
export function useBoard(projectId: string | null, enabled: boolean): BoardState {
  const [cards, setCards] = useState<BoardCard[]>([]);
  const [coordinators, setCoordinators] = useState<CoordinatorInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against a slow response for a project the user already left.
  const token = useRef(0);
  // Mirror for the event handler, which must not re-bind on every update.
  const cardsRef = useRef<BoardCard[]>(cards);
  cardsRef.current = cards;

  // Abgeleitet, nie gesetzt. Der Kern schickt eine Karte je Worker des Projekts,
  // Koordinatoren eingeschlossen (`get_board_state` liest `list_workers` und
  // filtert nichts weg) - eine zweite Sammlung daneben koennte nur
  // auseinanderlaufen.
  const attentionByWorker = useMemo(
    () => Object.fromEntries(cards.map((card) => [card.worker.id, card.attentionReason])),
    [cards],
  );

  const load = useCallback(
    async (showSpinner: boolean) => {
      const mine = ++token.current;
      if (!projectId) {
        setCards([]);
        setCoordinators([]);
        setError(null);
        setLoading(false);
        return;
      }
      if (showSpinner) setLoading(true);
      try {
        const next = await getBoardState(projectId);
        if (token.current !== mine) return;
        setCards(next.cards);
        setCoordinators(next.coordinators);
        setError(null);
      } catch (cause) {
        if (token.current === mine) setError(describeError(cause));
      } finally {
        // A silent refresh can supersede the initial spinner load. The last
        // request standing must clear that spinner even if it did not raise it.
        if (token.current === mine) setLoading(false);
      }
    },
    [projectId],
  );

  const refresh = useCallback(() => {
    void load(false);
  }, [load]);

  // Initial load + polling fallback.
  useEffect(() => {
    if (!enabled) return;
    void load(true);
    if (!projectId) return;
    const timer = window.setInterval(() => void load(false), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [enabled, load, projectId]);

  // Live column updates.
  useEffect(() => {
    if (!enabled || !projectId) return;
    let unlisten: UnlistenFn | null = null;
    let stale = false;

    void onWorkerStatus((payload) => {
      const known = cardsRef.current.some((card) => card.worker.id === payload.workerId);
      if (!known) {
        // A worker we have never seen — freshly created, or from another
        // project. Only a full fetch can tell us which.
        void load(false);
        return;
      }
      // Only the cards move here. The event carries a column and an attention
      // reason — nothing a coordinator chip shows — so rebuilding the banner
      // from it would only invent state; the next poll brings the real thing.
      // Die Karte ist zugleich die Quelle von `attentionByWorker`: ein Worker,
      // dessen Grund sich ändert, ändert ihn hier genau einmal.
      setCards((prev) =>
        prev.map((card) =>
          card.worker.id === payload.workerId
            ? {
                ...card,
                column: payload.column,
                attentionReason: payload.attentionReason,
                attentionCode: payload.attentionCode,
                attentionGrade: payload.attentionGrade,
                attentionObservedAt: payload.attentionObservedAt,
              }
            : card,
        ),
      );
    }).then((fn) => {
      if (stale) fn();
      else unlisten = fn;
    });

    return () => {
      stale = true;
      unlisten?.();
      unlisten = null;
    };
  }, [enabled, load, projectId]);

  return { cards, coordinators, attentionByWorker, loading, error, refresh };
}
