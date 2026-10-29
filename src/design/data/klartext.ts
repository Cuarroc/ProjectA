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

export function projectKlartext(input: KlartextInput): KlartextProjection {
  return { raw: input, operatingStatus: "unknown", evidenceStatus: "unbekannt",
    zustand: "Ruhig", label: "Ruhig", shape: "pause-circle", belegGrund: "Nicht implementiert." };
}
