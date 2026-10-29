import { useEffect, useRef } from "react";
import { de } from "../../i18n/de";
import { formatMessageTime, roleLabel } from "../../lib/orchestratorChat";
import { Chip } from "../controls/Chip";
import { Icon } from "../icons/Icon";
import { projectKlartext } from "../data/klartext";
import "./message.css";
import type { WorkerMessage } from "../../types";
import type { KlartextInput } from "../data/klartext";

export interface OrchestratorMessageProps {
  readonly id: string;
  readonly kind: "question" | "order" | "idea" | "approval-request" | "system";
  readonly role: WorkerMessage["role"];
  readonly source: "tab" | "voice" | "file";
  readonly status: KlartextInput;
  readonly observedAtSeconds?: number | null;
  readonly text: string;
  readonly completedParagraphs?: readonly { readonly id: string; readonly text: string }[];
  readonly nextStep: string;
  readonly loading?: boolean;
  readonly error?: string;
  readonly example?: boolean;
}

const symbols = { order: "chevron-right", idea: "zap", "approval-request": "flag", system: "list" } as const;

/** An unused message surface: the parent owns drafts, transport and thread navigation. */
export function OrchestratorMessage({ id, kind, role, source, status, observedAtSeconds, text,
  completedParagraphs, nextStep, loading, error, example = false }: OrchestratorMessageProps) {
  const live = useRef<HTMLDivElement>(null);
  const announced = useRef(new Set<string>());
  useEffect(() => {
    for (const paragraph of completedParagraphs ?? []) {
      const key = JSON.stringify([id, paragraph.id]);
      if (!paragraph.text.trim() || announced.current.has(key)) continue;
      announced.current.add(key);
      // Append literal text once: React rerenders and StrictMode do not repeat announcements.
      const node = document.createElement("p");
      node.textContent = paragraph.text;
      live.current?.append(node);
    }
  }, [id, completedParagraphs]);
  const projection = projectKlartext(status);
  const date = typeof observedAtSeconds === "number" && Number.isFinite(observedAtSeconds) && observedAtSeconds > 0
    ? new Date(observedAtSeconds * 1000) : undefined;
  const valid = date && Number.isFinite(date.getTime());
  const time = valid ? formatMessageTime(observedAtSeconds as number) : "";
  const label = de[`orchestratorMessage.${kind}`];
  const failed = !!error || projection.operatingStatus === "error";
  const shape = projection.shape;
  const proof = status.beleg;
  const freshness = proof?.freshness;
  return <article data-message={id} className={`g-om message${failed ? " has-error" : ""}`} aria-label={`${label}. ${roleLabel(role)}. ${projection.label}.`}>
    <h2 className="kind"><span className={`kind-shape kind-${kind}`} aria-hidden="true">{kind === "question" ? "?" : <Icon name={symbols[kind]} />}</span>{label}</h2>
    <div className="message-content">
      <div className="provenance"><strong>{roleLabel(role)}</strong><span>{de["orchestratorMessage.source"]}: {de[`orchestratorMessage.${source}`]}</span>
        <time dateTime={time ? date?.toISOString() : undefined}>{time || de["orchestratorMessage.unknownTime"]}</time></div>
      <div className="body" aria-busy={loading || undefined}>
        <p className={failed ? "error-copy" : undefined}>{text}</p>
        {error && error !== text && <p className="error-copy">{error}</p>}
        <div className="receipt"><span className={`state state-${shape}`}>
          <svg className="state-shape" aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={shape === "problem-triangle" ? 2 : 1.5}>
            {shape === "open-arc" ? <path d="M12.24 3.76a6 6 0 1 0 0 8.48" /> :
              shape === "diamond-dot" ? <><path d="M8 1 15 8 8 15 1 8Z" /><circle cx="8" cy="8" r="1.5" /></> :
              shape === "problem-triangle" ? <><path d="M8 2 14.5 14H1.5Z" /><path d="M8 6v3M8 11v.5" /></> :
              <><circle cx="8" cy="8" r="6" strokeDasharray={shape === "dashed-circle" ? "2 2" : undefined} />
                {shape === "check-circle" ? <path d="m4.5 8 2.5 2.5 4.5-5" /> : shape === "pause-circle" ? <path d="M6 5v6M10 5v6" /> : null}</>}
          </svg>{projection.label}</span><span className="evidence">{de["orchestratorMessage.evidence"]}: {projection.evidenceStatus}</span>
          <Chip>{projection.beleg ? de[example ? "orchestratorMessage.exampleProof" : "orchestratorMessage.proof"] : freshness === "stale"
            ? de[example ? "orchestratorMessage.exampleStale" : "orchestratorMessage.stale"] : de["orchestratorMessage.noProof"]}</Chip></div>
        <p className="next">{nextStep}</p>
        <details><summary><Icon name="chevron-right" />{de["orchestratorMessage.details"]}</summary>
          <p>{de["orchestratorMessage.id"]}: <code>{id}</code>. {de["orchestratorMessage.observed"]}: {time || de["orchestratorMessage.unknownTime"]}.</p>
          <p>{proof && <>{de["orchestratorMessage.source"]}: {proof.sourceId}; {de["orchestratorMessage.revision"]}: {proof.identity}. {example && de["orchestratorMessage.synthetic"]}</>}
            {!projection.beleg && <>{projection.belegGrund} {de["orchestratorMessage.noCurrentProof"]}</>}</p>
        </details>
      </div>
    </div>
    <div ref={live} className="g-om-live" role="log" aria-live="polite" aria-relevant="additions" />
  </article>;
}
