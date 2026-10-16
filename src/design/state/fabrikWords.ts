import type { STATE_UNKNOWN_FORM, StateForm } from "./states";

// Stub for the red test: no alias exists yet.
export const FABRIK_WORD_FORM = {} as Record<string, StateForm | typeof STATE_UNKNOWN_FORM>;

export function formForFabrikWord(_word: string): StateForm | typeof STATE_UNKNOWN_FORM | undefined {
  return undefined;
}
