import { de, type MessageKey } from "./de";
import { projectKlartext, type KlartextInput } from "../design/data/klartext";

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
  if (!Agent || !Paket) return de["klartext.satz.unknown"];
  const projected = projectKlartext(input.observation);
  if (projected.operatingStatus === "unknown" || projected.evidenceStatus === "unbekannt") return de["klartext.satz.unknown"];
  let template: MessageKey;
  const counts = input.boundCounts;
  if (input.kind === "work" && projected.zustand === de["klartext.satz.running"] && !input.observation.stopConfirmed) {
    if (!counts || !Number.isSafeInteger(counts.n) || !Number.isSafeInteger(counts.m)
      || counts.n == null || counts.m == null || counts.n < 0 || counts.m < 0 || counts.n > counts.m) return de["klartext.satz.countUnknown"];
    if (!projected.beleg) return de["klartext.satz.proofMissing"];
    if (counts.sourceId !== projected.beleg.sourceId || counts.identity !== projected.beleg.identity
      || counts.observedAt !== projected.beleg.observedAt) return de["klartext.satz.countUnknown"];
    template = "klartext.satz.work";
  } else if (input.kind === "decision" && projected.zustand === de["klartext.satz.waiting"]) {
    template = "klartext.satz.decision";
  } else if (input.kind === "problem" && projected.zustand === de["klartext.satz.problemState"]) {
    template = "klartext.satz.problem";
  } else if (input.kind === "result" && projected.operatingStatus === "completed") {
    if (projected.zustand !== de["klartext.satz.done"] || !projected.beleg) return de["klartext.satz.proofMissing"];
    template = "klartext.satz.result";
  } else return de["klartext.satz.unknown"];
  const sentence = de[template].replace(/\{(Agent|Paket|n|m)\}/g, (_, field: string) =>
    field === de["klartext.satz.agent"] ? Agent : field === de["klartext.satz.package"] ? Paket : String(field === "n" ? counts?.n : counts?.m));
  return sentence.split(/\s+/u).length > 20 ? de["klartext.satz.overflow"] : sentence;
}
