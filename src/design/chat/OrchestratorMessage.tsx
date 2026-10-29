import type { WorkerMessage } from "../../types";
import type { KlartextInput } from "../data/klartext";

export interface OrchestratorMessageProps {
  readonly id: string;
  readonly kind: "question" | "order" | "idea" | "approval-request" | "system";
  readonly role: WorkerMessage["role"];
  readonly source: "tab" | "voice" | "file";
  readonly status: KlartextInput;
  readonly observedAtSeconds?: number | null;
  readonly text: string;
  readonly completedParagraphs?: readonly { readonly id: string; readonly text: string }[];
  readonly nextStep: string;
  readonly loading?: boolean;
  readonly error?: string;
}

export function OrchestratorMessage(_props: OrchestratorMessageProps) {
  return null;
}
