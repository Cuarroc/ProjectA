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
}

function Badge({ label, stale, chip, children }: { label?: string; stale: boolean; chip?: boolean; children: ReactNode }) {
  return (
    <span className={chip ? "ps__badge ps__badge--chip" : "ps__badge"}>
      {label && <span className="ps__label">{label}</span>}
      {children}
      {/* The strip's accessible name carries the word once; the badges only show it. */}
      {stale && <small className="ps__stale" aria-hidden="true">{T.stale}</small>}
    </span>
  );
}

const missing = <span className="ps__missing">{T.notConnected}</span>;

/** Four proof badges: red-first, gates, review, PR. A fact the core has not sent
    reads "noch nicht verbunden"; it never gets a pass mark. Words from `texts.ts`. */
export function ProofStrip({ redFirst, gates, review, pr, stale }: ProofStripProps) {
  const link = pr && /^https?:\/\//i.test(pr.href) ? pr.href : null;
  const sha = pr?.sha?.slice(0, 7);
  const ref = sha ? <code>{sha}</code> : T.open;
  const run = pr && [pr.command, pr.exitCode === null ? null : `${T.exit} ${pr.exitCode}`].filter(Boolean).join(" ");
  return (
    <div className={stale ? "ps ps--stale" : "ps"} role="group" aria-label={stale ? T.staleName : T.strip}>
      <Badge label={T.redFirst} stale={stale}>
        {redFirst === "unknown" ? missing : (
          <span className={redFirst === "pass" ? "g-proof__yes" : "g-proof__no"}>
            {redFirst === "pass" ? T.redFirstPass : T.redFirstFail}
          </span>
        )}
      </Badge>
      {gates ? (
        <Badge stale={stale} chip><ProofChip gates={gates} /></Badge>
      ) : (
        <Badge label={de["proof.gates"]} stale={stale}>{missing}</Badge>
      )}
      <Badge label={T.review} stale={stale}>
        {review ? <span className={`g-proof__${review.tone}`}>{review.text}</span> : missing}
      </Badge>
      <Badge label={T.pr} stale={stale}>
        {pr ? (
          <>
            {link ? <a href={link}>{ref}</a> : ref}
            {run && <span className="ps__run">{run}</span>}
          </>
        ) : missing}
      </Badge>
    </div>
  );
}
