export interface ProposedEffect {
  readonly id: string;
  readonly action: string;
  readonly target?: string | null;
  readonly project?: string | null;
  readonly recipient?: string | null;
  readonly count?: number | null;
  readonly returnPath: { readonly kind: "proven" | "unproven" | "irreversible"; readonly description?: string };
  readonly authority?: { readonly state: "current" | "stale"; readonly label: string; readonly scope: string };
  readonly noConsequence: string;
}

export interface EffectCardProps {
  readonly effects: readonly ProposedEffect[];
  readonly mode?: "prepare" | "grant";
  readonly state?: "ready" | "loading" | "error" | "needs-user";
  readonly onPrepare?: (request: { readonly effectIds: readonly string[] }) => void;
  readonly onReject?: (request: { readonly effectIds: readonly string[] }) => void;
}

export function EffectCard(_props: EffectCardProps) {
  return null;
}
