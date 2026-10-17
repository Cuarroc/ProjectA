import type { ReactNode } from "react";
import { de } from "../../../i18n/de";
import { ProofChip, type GateTick, type ProofTone } from "../../../design/data/ProofChip";
import "./proof.css";
import { T } from "./texts";

export interface ProofStripProps {
  redFirst: "pass" | "fail" | "unknown";
  /** `null` = the core has not sent gates. */
  gates: readonly GateTick[] | null;
  review: { tone: ProofTone; text: string } | null;
  pr: { href: string; sha: string | null; command: string | null; exitCode: number | null } | null;
  /** The caller says a later commit invalidated this proof. */
  stale: boolean;
  /** One line for a small host (the flow node): marks instead of words; the words stay for the tooltip and assistive tech. */
  compact?: boolean;
}

function Badge({ label, title, stale, chip, children }: { label?: string; title?: string; stale: boolean; chip?: boolean; children: ReactNode }) {
  return (
    <span className={chip ? "ps__badge ps__badge--chip" : "ps__badge"} title={title}>
      {label && <span className="ps__label">{label}</span>}
      {children}
      {/* The strip's accessible name carries the word once; the badges only show it. */}
      {stale && <small className="ps__stale" aria-hidden="true">{T.stale}</small>}
    </span>
  );
}

const MARK: Record<ProofTone, string> = { yes: "✓", no: "✕", wip: "…" };

/** Four proof badges: red-first, gates, review, PR. A fact the core has not sent
    reads "noch nicht verbunden"; it never gets a pass mark. Words from `texts.ts`.
    `compact` draws a mark per value instead of the words (they stay in the tooltip
    and for assistive tech) and a short red-first label, so the strip is one line. */
export function ProofStrip({ redFirst, gates, review, pr, stale, compact = false }: ProofStripProps) {
  // `tip` off: the mark sits inside a link whose own title is the tooltip and an inner title would shadow it.
  const word = (className: string, mark: string, text: string, tip = true) => compact ? (
    <>
      <span className={className} title={tip ? text : undefined} aria-hidden="true">{mark}</span>
      <span className="sr-only">{text}</span>
    </>
  ) : <span className={className}>{text}</span>;
  // All four unknown: one line, not four stacked "not connected" pills. The compact node strip is one line already.
  if (!compact && redFirst === "unknown" && !gates && !review && !pr) {
    return (
      <div className={`ps${stale ? " ps--stale" : ""}`} role="group" aria-label={stale ? T.staleName : T.strip}>
        <span className="ps__label">{T.strip}:</span> <span className="ps__missing">{T.notConnected}</span>
      </div>
    );
  }
  const missing = word("ps__missing", "–", T.notConnected);
  const link = pr && /^https?:\/\//i.test(pr.href) ? pr.href : null;
  const sha = pr?.sha?.slice(0, 7);
  const ref = compact && link ? word("ps__open", "↗", T.open, false) : sha ? <code>{sha}</code> : T.open;
  const run = pr && [pr.command, pr.exitCode === null ? null : `${T.exit} ${pr.exitCode}`].filter(Boolean).join(" ");
  return (
    <div className={`ps${compact ? " ps--compact" : ""}${stale ? " ps--stale" : ""}`} role="group" aria-label={stale ? T.staleName : T.strip}>
      <Badge label={compact ? T.redFirstShort : T.redFirst} title={compact ? T.redFirst : undefined} stale={stale}>
        {redFirst === "unknown" ? missing : redFirst === "pass"
          ? word("g-proof__yes", MARK.yes, T.redFirstPass)
          : word("g-proof__no", MARK.no, T.redFirstFail)}
      </Badge>
      {gates && compact ? (
        <Badge label={de["proof.gates"]} stale={stale}><span className="ps__count">{gates.filter((g) => g === "pass").length}/{gates.length}</span></Badge>
      ) : gates ? (
        <Badge stale={stale} chip><ProofChip gates={gates} /></Badge>
      ) : (
        <Badge label={de["proof.gates"]} stale={stale}>{missing}</Badge>
      )}
      <Badge label={T.review} stale={stale}>
        {review ? word(`g-proof__${review.tone}`, MARK[review.tone], review.text) : missing}
      </Badge>
      <Badge label={T.pr} stale={stale}>
        {pr ? (
          <>
            {link ? <a href={link} title={compact ? [sha, run].filter(Boolean).join(" ") || undefined : undefined}>{ref}</a> : ref}
            {run && !compact && <span className="ps__run">{run}</span>}
          </>
        ) : missing}
      </Badge>
    </div>
  );
}
