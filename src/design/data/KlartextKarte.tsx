import { useEffect, useId, useRef, useState } from "react";
import { formatClock, formatDayMonth } from "../../lib/time";
import { de } from "../../i18n/de";
import { Button } from "../controls/Button";
import { Popover } from "../layout/Popover";
import { StateMark } from "../state/StateMark";
import { ProofChip } from "./ProofChip";
import "./klartext-card.css";
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

export function KlartextKarte({ id, satz, projection: p, naechstes, vonDir, facts, level, proofMeta,
  compact, loading, detailsOpen, onDetailsChange, technical, onInspect }: KlartextKarteProps) {
  const uid = useId(), [explanation, setExplanation] = useState(false), [announcement, setAnnouncement] = useState("");
  const last = useRef("");
  const fromYouField: "vonDir" = de["klartext.card.fromYouField"];
  const proofText = p.beleg ? de["klartext.card.hasProof"] : p.belegGrund;
  const name = `${p.zustand}. ${satz} ${proofText} ${de["klartext.card.fromYou"]}${de["klartext.card.labelSeparator"]}${vonDir}`;
  const form = ({ "open-arc": "run", "diamond-dot": "need", "check-circle": "done",
    "problem-triangle": "bad", "pause-circle": undefined, "dashed-circle": undefined } as const)[p.shape];
  const meta = p.beleg && proofMeta?.sourceId === p.beleg.sourceId && proofMeta.identity === p.beleg.identity
    && proofMeta.observedAt === p.beleg.observedAt ? proofMeta : undefined;
  const proof = p.beleg, source = p.raw.source;
  const checkedAt = source?.checkedAt, observedAt = proof?.observedAt;
  const checkedDate = new Date(checkedAt ?? NaN), observedDate = new Date(observedAt ?? NaN);
  useEffect(() => {
    const key = `${id}:${p.zustand}`;
    if (last.current === key) return;
    last.current = key;
    setAnnouncement(p.zustand === de["klartext.need"] || p.zustand === de["klartext.problem"]
      ? `${name} ${de["klartext.card.next"]}${de["klartext.card.labelSeparator"]}${naechstes}` : "");
  }, [id, p.zustand, name, naechstes]);
  const rows = [
    [de["klartext.card.scope"], facts.scope], [de["klartext.card.target"], facts.target],
    [de["effect.project"], facts.project], [de["effect.count"], facts.count], [de["effect.recipient"], facts.recipient],
    [de["effect.what"], facts.effect], [de["effect.authority"], facts.authority], [de["effect.return"], facts.return],
    [de["klartext.card.progress"], facts.progress], [de["klartext.card.quota"], facts.quota],
  ];
  const allUnknown = rows.every(([, value]) => value == null || value === de["effect.unknown"]);
  return <article className={`g-kl${compact ? " g-kl--compact" : ""}`} data-shape={p.shape} aria-label={name}>
    <h3 data-field="satz">{satz}</h3>
    <div className="g-kl__state" data-field="zustand"><StateMark form={form} label={p.label === p.zustand ? p.label : `${p.zustand}${de["klartext.card.stateSeparator"]}${p.label}`} />{checkedAt && Number.isFinite(checkedDate.getTime()) && <time dateTime={checkedAt}>
      {formatDayMonth(checkedDate)} {formatClock(checkedDate)}
    </time>}</div>
    <div className="g-kl__proof" data-field="beleg"><span>{proofText}</span>{meta?.gates
      ? <ProofChip gates={meta.gates} href={meta.href} /> : <span>{de["klartext.card.gatesUnknown"]}</span>}
      <span>{de[`klartext.card.${proof?.freshness ?? "unknown"}`]}
        {observedAt && Number.isFinite(observedDate.getTime()) && <time dateTime={observedAt}>
          {" "}{formatDayMonth(observedDate)} {formatClock(observedDate)}
        </time>}
      </span>
    </div>
    <dl className="g-kl__lines">
      <div data-field="naechstes"><dt>{de["klartext.card.next"]}</dt><dd>{naechstes}</dd></div>
      <div data-field={fromYouField}><dt>{de["klartext.card.fromYou"]}</dt><dd>{vonDir}<Button variant="primary" loading={loading} onClick={() => onInspect(id)}>{de["klartext.card.inspect"]}</Button></dd></div>
    </dl>
    <dl className="g-kl__facts">{allUnknown
      ? <div className="g-kl__unknown"><dt>{rows.map(([label]) => label).join(de["klartext.card.factSeparator"])}</dt><dd>{de["effect.unknown"]}</dd></div>
      : rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? de["effect.unknown"]}</dd></div>)}
      <div><dt>{de["klartext.card.source"]}</dt><dd>{source?.id ?? de["effect.unknown"]}<br /><code>{source?.identity ?? de["effect.unknown"]}</code></dd></div>
      <div><dt>{de["klartext.card.rightsLevel"]}</dt><dd>{de["klartext.card.rights"].replace("{level}", String(level))}</dd></div>
    </dl>
    <footer><details open={detailsOpen}><summary aria-expanded={detailsOpen} aria-controls={`${uid}-technical`} onClick={e => { e.preventDefault(); onDetailsChange(id, !detailsOpen); }}>{de["klartext.card.details"]}</summary>
      <p id={`${uid}-technical`}>{technical}</p></details>
      <Popover open={explanation} onOpenChange={setExplanation} align="end" panelClassName="g-kl__explanation"
        trigger={trigger => <button {...trigger} type="button" className="g-btn g-btn--ghost" onClick={() => setExplanation(!explanation)}>{de["klartext.card.explain"]}</button>}>
        {([ ["klartext.card.what", "klartext.card.whatText"], ["klartext.card.why", "klartext.card.whyText"],
          ["klartext.card.do", "klartext.card.doText"] ] as const).map(([heading, text]) => <section key={heading}><h4>{de[heading]}</h4><p>{de[text]}</p></section>)}
        <p>{de["klartext.card.explanationSource"]}</p><Button onClick={() => setExplanation(false)}>{de["action.close"]}</Button>
      </Popover>
    </footer>
    <span className="g-kl__live" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
  </article>;
}
