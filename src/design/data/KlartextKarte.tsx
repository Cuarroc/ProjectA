import type { KlartextProjection } from "./klartext";
import type { GateTick } from "./ProofChip";

export interface KlartextKarteProps {
  readonly id: string;
  /** Trusted, data-derived active sentence, at most twenty words; never a model claim. */
  readonly satz: string;
  readonly projection: KlartextProjection;
  readonly naechstes: string;
  readonly vonDir: string;
  readonly facts: Readonly<{
    scope: string; target: string; project: string; count: number | null; recipient: string;
    effect: string; authority: string; return: string; progress: string; quota: string | null;
  }>;
  readonly level: 1 | 2 | 3;
  readonly proofMeta?: Readonly<{ sourceId: string; identity: string; observedAt: string; gates: readonly GateTick[] | null; href?: string }>;
  readonly compact?: boolean;
  readonly loading?: boolean;
  readonly detailsOpen: boolean;
  readonly onDetailsChange: (id: string, open: boolean) => void;
  readonly technical: string;
  readonly onInspect: (id: string) => void;
}

export function KlartextKarte(_props: KlartextKarteProps) {
  return null;
}
