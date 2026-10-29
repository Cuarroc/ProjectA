import { klartextTemplates as text } from "../../i18n/klartextTemplates";
import { projectKlartext, type KlartextInput } from "./klartext";

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

// Labels must already be classified as trusted display data by the adapter.
function display(value: string, words: number, chars: number): string | undefined {
  if (typeof value !== "string" || /[\p{Cc}\p{Cf}]/u.test(value)) return undefined;
  const label = value.trim().replace(/\s+/gu, " ");
  if (!/^[\p{L}\p{Nd} .-]+$/u.test(label) || !/\p{L}/u.test(label)
    || [...label].length > chars || label.split(" ").length > words
    || /(?:^|[ .-])(?:password|passwd|secret|token|credential|bearer|apikey|api-key)(?=$|[ .-])|(?:^|[ .-])(?:sk-|ghp_)|\bwww\./iu.test(label)) return undefined;
  return label;
}

export function formatKlartext(input: KlartextTextInput): string {
  const Agent = display(input.Agent, 4, 48), Paket = display(input.Paket, 11, 100);
  if (!Agent || !Paket) return text.unknown;
  const projected = projectKlartext(input.observation);
  if (projected.operatingStatus === "unknown" || projected.evidenceStatus === "unbekannt") return text.unknown;
  let template: string;
  const counts = input.boundCounts;
  if (input.kind === "work" && projected.zustand === "Läuft" && !input.observation.stopConfirmed) {
    if (!counts || !Number.isSafeInteger(counts.n) || !Number.isSafeInteger(counts.m)
      || counts.n == null || counts.m == null || counts.n < 0 || counts.m < 0 || counts.n > counts.m) return text.countUnknown;
    if (!projected.beleg) return text.proofMissing;
    if (counts.sourceId !== projected.beleg.sourceId || counts.identity !== projected.beleg.identity
      || counts.observedAt !== projected.beleg.observedAt) return text.countUnknown;
    template = text.work;
  } else if (input.kind === "decision" && projected.zustand === "Wartet auf dich") {
    template = text.decision;
  } else if (input.kind === "problem" && projected.zustand === "Problem") {
    template = text.problem;
  } else if (input.kind === "result" && projected.operatingStatus === "completed") {
    if (projected.zustand !== "Fertig mit Beleg" || !projected.beleg) return text.proofMissing;
    template = text.result;
  } else return text.unknown;
  const sentence = template.replace(/\{(Agent|Paket|n|m)\}/g, (_, field: string) =>
    field === "Agent" ? Agent : field === "Paket" ? Paket : String(field === "n" ? counts?.n : counts?.m));
  return sentence.split(/\s+/u).length > 20 ? text.overflow : sentence;
}
