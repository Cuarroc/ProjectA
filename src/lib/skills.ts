import { useCallback, useEffect, useRef, useState } from "react";

import {
  describeError,
  getProjectSkillPacks,
  listSkillPacks,
  setProjectSkillPacks,
} from "./ipc";
import type { SkillPack } from "../types";

/**
 * Skill packs ship with the app, so the catalogue is fetched once and shared.
 * The per-project selection is shared too: the settings dialog and the chips in
 * the new-worker dialog must never disagree about what is enabled.
 */
let catalogue: SkillPack[] | null = null;
let catalogueInFlight: Promise<SkillPack[]> | null = null;

const enabledByProject = new Map<string, string[]>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function loadCatalogue(): Promise<SkillPack[]> {
  if (catalogue) return Promise.resolve(catalogue);
  if (catalogueInFlight === null) {
    // A failed fetch clears the slot so the next open may try again.
    catalogueInFlight = listSkillPacks().then(
      (packs) => {
        catalogue = packs;
        catalogueInFlight = null;
        return packs;
      },
      (cause) => {
        catalogueInFlight = null;
        throw cause;
      },
    );
  }
  return catalogueInFlight;
}

/**
 * The enabled set in catalogue order, with ids the catalogue does not know
 * about kept at the end rather than silently dropped on the next write.
 */
function orderedSelection(selected: Set<string>): string[] {
  const known = (catalogue ?? []).map((pack) => pack.id);
  const ordered = known.filter((id) => selected.has(id));
  const extra = [...selected].filter((id) => !known.includes(id));
  return [...ordered, ...extra];
}

export interface SkillPackState {
  /** Every installed pack. Empty while the catalogue is still loading. */
  packs: SkillPack[];
  /** Enabled pack ids, or `null` while nothing is known yet. */
  enabled: string[] | null;
  loading: boolean;
  /** Load or save failure; the selection stays usable either way. */
  error: string | null;
  /** Turns one pack on or off and persists the whole set immediately. */
  toggle: (packId: string, on: boolean) => void;
  saving: boolean;
}

/**
 * The skill packs of one project. Reads the catalogue and the project's
 * selection on mount, and keeps every mounted consumer in step with writes.
 */
export function useProjectSkillPacks(projectId: string | null): SkillPackState {
  const [packs, setPacks] = useState<SkillPack[]>(() => catalogue ?? []);
  const [enabled, setEnabled] = useState<string[] | null>(() =>
    projectId === null ? null : enabledByProject.get(projectId) ?? null,
  );
  const [loading, setLoading] = useState(projectId !== null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // A write anywhere in the app is a write here too.
  useEffect(() => {
    const listener = () => {
      setPacks(catalogue ?? []);
      setEnabled(projectId === null ? null : enabledByProject.get(projectId) ?? null);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [projectId]);

  useEffect(() => {
    if (projectId === null) {
      setEnabled(null);
      setLoading(false);
      setError(null);
      return;
    }
    let stale = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const [list, ids] = await Promise.all([loadCatalogue(), getProjectSkillPacks(projectId)]);
        enabledByProject.set(projectId, ids);
        if (stale) return;
        setPacks(list);
        setEnabled(ids);
      } catch (cause) {
        if (!stale) setError(describeError(cause));
      } finally {
        if (!stale) setLoading(false);
      }
    })();
    return () => {
      stale = true;
    };
  }, [projectId]);

  const toggle = useCallback(
    (packId: string, on: boolean) => {
      if (projectId === null) return;
      const before = enabledByProject.get(projectId) ?? [];
      const selected = new Set(before);
      if (on) selected.add(packId);
      else selected.delete(packId);
      const next = orderedSelection(selected);

      // Optimistic: a checkbox must not lag behind the click that ticked it.
      enabledByProject.set(projectId, next);
      emit();
      setSaving(true);
      void (async () => {
        try {
          await setProjectSkillPacks(projectId, next);
          if (alive.current) setError(null);
        } catch (cause) {
          // The write did not land, so put the old selection back on screen.
          enabledByProject.set(projectId, before);
          emit();
          if (alive.current) setError(describeError(cause));
        } finally {
          if (alive.current) setSaving(false);
        }
      })();
    },
    [projectId],
  );

  return { packs, enabled, loading, error, toggle, saving };
}

/**
 * Whether this is the one pack still enabled, and so may not be unticked.
 *
 * The core stores an empty selection as "never configured", which reads back
 * as every pack — so "no packs at all" is not a state the project can be put
 * into, and the UI must not pretend otherwise.
 */
export function isLastEnabled(enabled: string[], packId: string): boolean {
  return enabled.length === 1 && enabled[0] === packId;
}

/** The pack's name, or its bare id when the catalogue has never heard of it. */
export function packLabel(packs: SkillPack[], packId: string): string {
  return packs.find((pack) => pack.id === packId)?.name ?? packId;
}
