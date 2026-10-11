/** The active project survives a restart; the Glass header and the old app share it through this module. */
const KEY = "projecta.activeProjectId";
const EVENT = "projecta:active-project";

export function readActiveProjectId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null; // storage disabled — the app works, it just forgets.
  }
}

/** Stores the id and tells subscribers; a write that changes nothing stays silent. */
export function writeActiveProjectId(id: string | null): void {
  if (readActiveProjectId() === id) return;
  try {
    if (id === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, id);
  } catch {
    // Storage disabled — subscribers still hear about it.
  }
  window.dispatchEvent(new CustomEvent<string | null>(EVENT, { detail: id }));
}

/** Calls `cb` on every change; returns the unsubscribe function. */
export function subscribeActiveProject(cb: (id: string | null) => void): () => void {
  const on = (e: Event) => cb((e as CustomEvent<string | null>).detail);
  window.addEventListener(EVENT, on);
  return () => window.removeEventListener(EVENT, on);
}
