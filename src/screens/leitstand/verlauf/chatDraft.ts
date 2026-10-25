import { useState, useSyncExternalStore } from "react";

import type { OrchestratorChat } from "../../../lib/orchestratorChat";

const empty = { value: { text: "" }, sending: false, error: null as string | null };
type Draft = typeof empty;
function createDrafts() {
  const entries = new Map<string, Draft>();
  const listeners = new Set<() => void>();
  const read = (projectId: string | null) => entries.get(projectId ?? "") ?? empty;
  const patch = (projectId: string | null, changes: Partial<Draft>) => {
    if (projectId === null) return;
    const next = { ...read(projectId), ...changes };
    if (next.value.text === "" && !next.sending && next.error === null) entries.delete(projectId);
    else entries.set(projectId, next);
    listeners.forEach((listener) => listener());
  };
  return { read, patch, subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  } };
}

// UI-session memory only: one current draft per project, no history or eviction of unsent text.
const retainedDrafts = createDrafts();
export function useChatDraft(projectId: string | null, retain: boolean) {
  const [local] = useState(createDrafts);
  const store = retain ? retainedDrafts : local;
  const draft = useSyncExternalStore(store.subscribe, () => store.read(projectId));
  const patch = (changes: Partial<Draft>) => store.patch(projectId, changes);
  const submit = async (send: OrchestratorChat["send"]) => {
    const submitted = store.read(projectId);
    if (projectId === null || submitted.sending || submitted.value.text.trim() === "") return;
    patch({ sending: true });
    try {
      const sent = retain
        ? await send(submitted.value.text, (error) => patch({ error }))
        : await send(submitted.value.text);
      if (sent) {
        patch({ error: null });
        // Identity tracks edits even if the user returns to exactly the same text.
        if (store.read(projectId).value === submitted.value) patch({ value: empty.value });
      }
    } finally {
      patch({ sending: false });
    }
  };
  return { text: draft.value.text, sending: draft.sending, error: draft.error, submit,
    setText: (text: string) => patch({ value: { text } }),
    clearError: () => patch({ error: null }),
  };
}
