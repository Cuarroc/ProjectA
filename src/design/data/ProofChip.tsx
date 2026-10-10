import { Fragment, type ReactNode } from "react";
import "./data.css";

export type GateTick = "pass" | "fail" | "wip" | "none";
export type ProofTone = "yes" | "no" | "wip";

export interface ProofChipProps {
  gates: readonly GateTick[];
  verdict?: { tone: ProofTone; text: string };
  sha?: string;
  /** Makes the chip a link to the full proof. */
  href?: string;
}

/** Signature chip: gate ticks, "Gates n/m" in words, optional verdict and commit.
    The ticks are colour only, so the count and the verdict are always text.
    German is hard-wired until the V2-F6 dictionary. */
export function ProofChip({ gates, verdict, sha, href }: ProofChipProps) {
  const passed = gates.filter((g) => g === "pass").length;
  const parts: ReactNode[] = [
    `Gates ${passed}/${gates.length}`,
    verdict && <span key="v" className={`g-proof__${verdict.tone}`}>{verdict.text}</span>,
    sha && <code key="s">{sha.slice(0, 7)}</code>,
  ].filter(Boolean);
  const body = (
    <>
      <span className="g-proof__ticks" aria-hidden="true">
        {gates.map((g, i) => <i key={i} className={`g-proof__t--${g}`} />)}
      </span>
      {parts.map((p, i) => (i === 0 ? <span key="g">{p}</span> : (
        <Fragment key={`p${i}`}><span className="g-proof__sep" />{p}</Fragment>
      )))}
    </>
  );
  return href ? <a className="g-proof" href={href}>{body}</a> : <span className="g-proof">{body}</span>;
}
