import type { STATE_UNKNOWN_FORM, StateForm } from "../state/states";

export type OrbState = StateForm | typeof STATE_UNKNOWN_FORM;

// Stub for the red test: renders nothing yet.
export function Orb(_props: { state: OrbState | undefined; label: string }) {
  return null;
}
