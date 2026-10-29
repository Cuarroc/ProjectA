import { de } from "../../i18n/de";
import type { StateForm } from "../state/states";

export type OperatingStatus = "running" | "completed" | "error" | "quiet" | "unknown";
export type EvidenceStatus = "bewiesen" | "gemeldet" | "vorgeschlagen" | "unbekannt";
export type KlartextState = "Läuft" | "Wartet auf dich" | "Fertig mit Beleg" | "Problem" | "Ruhig" | "Unbelegt";

export interface KlartextProof {
  readonly sourceId: string;
  readonly identity: string;
  readonly observedAt: string;
  readonly freshness: "fresh" | "stale" | "unknown";
}

/** Supplied evidence/source data must already be trusted; this projection grants no authority. */
export interface KlartextInput {
  readonly operatingStatus: string;
  readonly evidenceStatus: string;
  readonly boardForm: StateForm | "unknown";
  readonly source?: { readonly id: string; readonly identity: string; readonly checkedAt: string };
  readonly beleg?: KlartextProof;
  readonly needsUser?: boolean;
  readonly stopRequested?: boolean;
  readonly stopConfirmed?: boolean;
  readonly modelClaim?: string;
}

interface ProjectionData {
  readonly raw: KlartextInput;
  readonly operatingStatus: OperatingStatus;
  readonly evidenceStatus: EvidenceStatus;
  readonly label: string;
  readonly shape: "open-arc" | "diamond-dot" | "check-circle" | "problem-triangle" | "pause-circle" | "dashed-circle";
}

type ProofOrReason = { readonly beleg: KlartextProof; readonly belegGrund?: never }
  | { readonly beleg?: never; readonly belegGrund: string };

export type KlartextProjection = ProjectionData & (
  | { readonly zustand: "Fertig mit Beleg"; readonly beleg: KlartextProof; readonly belegGrund?: never }
  | ({ readonly zustand: Exclude<KlartextState, "Fertig mit Beleg"> } & ProofOrReason)
);

function knownIdentity(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && value !== "unknown";
}

function usableProof(input: KlartextInput): KlartextProof | undefined {
  const { beleg, source } = input;
  if (input.evidenceStatus !== "bewiesen" || !beleg || !source
    || beleg.freshness !== "fresh" || !knownIdentity(source.id) || !knownIdentity(source.identity)
    || beleg.sourceId !== source.id || beleg.identity !== source.identity
    || typeof beleg.observedAt !== "string" || typeof source.checkedAt !== "string") return undefined;
  const observed = Date.parse(beleg.observedAt);
  const checked = Date.parse(source.checkedAt);
  // Freshness is supplied by the source; timestamps only establish a known, consistent order.
  return Number.isFinite(observed) && Number.isFinite(checked) && observed <= checked ? beleg : undefined;
}

const shapes: Record<KlartextState, ProjectionData["shape"]> = {
  [de["state.run"]]: "open-arc", [de["klartext.need"]]: "diamond-dot", [de["klartext.done"]]: "check-circle",
  [de["klartext.problem"]]: "problem-triangle", [de["klartext.quiet"]]: "pause-circle", [de["klartext.unproven"]]: "dashed-circle",
};

export function projectKlartext(input: KlartextInput): KlartextProjection {
  const operatingStatus: OperatingStatus = ["running", "completed", "error", "quiet"].includes(input.operatingStatus)
    ? input.operatingStatus as OperatingStatus : "unknown";
  const evidenceStatus: EvidenceStatus = ["bewiesen", "gemeldet", "vorgeschlagen"].includes(input.evidenceStatus)
    ? input.evidenceStatus as EvidenceStatus : "unbekannt";
  const data = { raw: input, operatingStatus, evidenceStatus };
  const beleg = usableProof(input);
  let zustand: Exclude<KlartextState, "Fertig mit Beleg"> = de["klartext.quiet"];
  let label: string | undefined;

  if (operatingStatus === "unknown" || evidenceStatus === "unbekannt") {
    zustand = de["klartext.unproven"];
    label = de["klartext.unknownLabel"];
  } else if (operatingStatus === "completed") {
    if (beleg) return { ...data, zustand: de["klartext.done"], label: de["klartext.done"],
      shape: shapes[de["klartext.done"]], beleg };
    zustand = de["klartext.unproven"];
  } else if (operatingStatus === "error") {
    zustand = de["klartext.problem"];
  } else if (input.stopConfirmed === true) {
    label = de["klartext.stopped"];
  } else if (operatingStatus === "running") {
    zustand = de["state.run"];
    if (input.stopRequested === true) label = de["klartext.stopRequested"];
  } else if (evidenceStatus === "vorgeschlagen" && input.needsUser === true) {
    zustand = de["klartext.need"];
  }

  return { ...data, zustand, label: label ?? zustand, shape: shapes[zustand],
    ...(beleg && operatingStatus !== "unknown" ? { beleg } : { belegGrund: de["klartext.noProof"] }) };
}
