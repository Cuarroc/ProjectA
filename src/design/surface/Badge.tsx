import type { HTMLAttributes } from "react";
import "./surface.css";

export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, "tabIndex"> {
  /** Shown when finite; 0 stays visible. Children win over it. */
  count?: number;
  tone?: "neutral" | "accent";
}

/** A count or a tag, always as text. It does not carry state: use StateMark for that, ProofChip for proof. */
export function Badge({ count, tone = "neutral", className, children, ...rest }: BadgeProps) {
  const text = children ?? (typeof count === "number" && Number.isFinite(count) ? count : null);
  if (text === null) return null;
  // A static label never takes focus: drop any tabIndex a loose caller passes.
  const attrs: Record<string, unknown> = { ...rest };
  delete attrs.tabIndex;
  return <span className={["g-badge", tone === "accent" && "g-badge--accent", className].filter(Boolean).join(" ")} {...attrs}>{text}</span>;
}
