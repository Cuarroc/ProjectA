import { klartextTemplates as text } from "../../i18n/klartextTemplates";
import { type KlartextInput } from "./klartext";

export interface BoundCounts {
  readonly n?: number | null;
  readonly m?: number | null;
  readonly sourceId?: string;
  readonly identity?: string;
  readonly observedAt?: string;
}
export interface KlartextTextInput {
  readonly kind: string;
  readonly Agent: string;
  readonly Paket: string;
  readonly observation: KlartextInput;
  readonly boundCounts?: BoundCounts;
}

export function formatKlartext(input: KlartextTextInput): string {
  void input;
  return text.unknown;
}
