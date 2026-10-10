import type { StateForm } from "../../design/state/states";

/**
 * The first step that is neither ready nor done is "the current one"; when
 * every step is done, the last one ("Fertig") is.
 */
export function currentStepIndex(forms: readonly StateForm[]): number {
  const open = forms.findIndex((f) => f === "need" || f === "bad" || f === "run");
  return open === -1 ? forms.length - 1 : open;
}
