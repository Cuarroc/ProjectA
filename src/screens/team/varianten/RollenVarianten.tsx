import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import "../../../design/controls/controls.css";
import "../../../design/glass.css";
import "../../../design/inputs/inputs.css";
import { Button } from "../../../design/controls/Button";
import { Chip } from "../../../design/controls/Chip";
import { HonestState } from "../../../design/data/HonestState";
import { Avatar } from "../../../design/inputs/Avatar";
import { approveRoleVariant, describeError, listRoleVariants, rejectRoleVariant } from "../../../lib/ipc";
import type { RoleVariant } from "../../../types";
import { initials, toneFor } from "../../leitstand/leitstand";
import "../personas.css";
import { T } from "./texts";

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; variants: RoleVariant[] };
type Note = { kind: "ok" | "error"; text: string };
type Verdict = "approve" | "reject";

// The addition rides along in every future spawn's system prompt, so it is
// shown in full before the verdict (KI-1), never folded away.
const PROMPT_STYLE: CSSProperties = {
  margin: 0,
  padding: 8,
  maxHeight: 160,
  overflow: "auto",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  borderRadius: 8,
  background: "var(--g-tint)",
  color: "var(--g-ink)",
  fontFamily: "var(--g-font-mono)",
  fontSize: 12,
  lineHeight: 1.4,
};

const TITLE_STYLE: CSSProperties = { margin: 0, fontWeight: 600, fontSize: 16, color: "var(--g-ink)" };

function VariantCard({ variant, busy, onVerdict }: { variant: RoleVariant; busy: boolean; onVerdict: (verdict: Verdict) => void }) {
  return (
    <article className="g-glass ps-card" aria-label={variant.name} aria-busy={busy}>
      <div className="ps-head">
        <Avatar initials={initials(variant.name)} tone={toneFor(variant.id)} />
        <div className="ps-who">
          <h3 title={variant.name}>{variant.name}</h3>
          <p title={T.base}>{variant.baseProfileId}</p>
        </div>
        {variant.version > 1 && <Chip title={T.newerHint}>{T.newer}</Chip>}
      </div>
      <div className="ps-chips">
        {variant.patternLabel !== "" && <Chip size="sm" title={T.pattern}>{variant.patternLabel}</Chip>}
        <Chip size="sm">{`v${variant.version}`}</Chip>
      </div>
      <pre style={PROMPT_STYLE} role="region" tabIndex={0} aria-label={T.promptLabel}>{variant.systemPromptAddition}</pre>
      <div className="ps-chips" style={{ marginTop: "auto" }}>
        <Button size="sm" variant="primary" disabled={busy} onClick={() => onVerdict("approve")}>{busy ? T.working : T.approve}</Button>
        <Button size="sm" disabled={busy} onClick={() => onVerdict("reject")}>{T.reject}</Button>
      </div>
    </article>
  );
}

/** Team › Personas: the role variants waiting for a verdict. Not mounted yet (V2-S07b-2). */
export function RollenVarianten({ projectId }: { projectId: string }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [note, setNote] = useState<Note | null>(null);
  const [reloadFailed, setReloadFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  // Counts project changes: a reply is only taken while its token is current,
  // so a late reply of an earlier visit to the same project is dropped too.
  const generation = useRef(0);
  // Counts reads within one project: an older read that finishes after a newer
  // one must not overwrite it, so a rejected-then-decided card cannot return.
  const requestSeq = useRef(0);

  /** A silent reload keeps the cards on screen; a failed one is only a quiet line. */
  const fetchVariants = useCallback(async (silent: boolean) => {
    const mine = generation.current;
    const seq = ++requestSeq.current;
    if (!silent) setLoad({ status: "loading" });
    try {
      const all = await listRoleVariants(projectId);
      if (generation.current !== mine || seq !== requestSeq.current) return;
      setReloadFailed(false);
      setLoad({ status: "ready", variants: all.filter((v) => v.status === "pending") });
    } catch {
      if (generation.current !== mine || seq !== requestSeq.current) return;
      if (silent) setReloadFailed(true);
      else setLoad({ status: "error" });
    }
  }, [projectId]);

  useEffect(() => {
    generation.current += 1;
    setBusy(new Set());
    setNote(null);
    setReloadFailed(false);
    setRetrying(false);
    void fetchVariants(false);
  }, [fetchVariants]);

  /** Reads the list again after a failed silent reload, without a verdict. */
  const retryReload = async () => {
    setRetrying(true);
    try {
      await fetchVariants(true);
    } finally {
      setRetrying(false);
    }
  };

  const setBusyFor = (id: string, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const decide = async (variant: RoleVariant, verdict: Verdict) => {
    const mine = generation.current;
    setBusyFor(variant.id, true);
    setNote(null);
    try {
      await (verdict === "approve" ? approveRoleVariant : rejectRoleVariant)(variant.id);
      if (generation.current !== mine) return;
      setNote({ kind: "ok", text: verdict === "approve" ? T.approved : T.rejected });
      // Decided is decided: drop the card now so a failed reload cannot leave it clickable.
      setLoad((prev) => (prev.status === "ready" ? { status: "ready", variants: prev.variants.filter((v) => v.id !== variant.id) } : prev));
      await fetchVariants(true);
    } catch (cause) {
      if (generation.current === mine) {
        setNote({ kind: "error", text: `${verdict === "approve" ? T.approveFailed : T.rejectFailed} ${describeError(cause)}` });
      }
    } finally {
      if (generation.current === mine) setBusyFor(variant.id, false);
    }
  };

  const variants = load.status === "ready" ? load.variants : [];
  return (
    <div className="ps-screen">
      <header className="ps-top">
        <h2 style={TITLE_STYLE}>{T.title}</h2>
        <p>{T.lead}</p>
      </header>
      {note?.kind === "ok" && <p role="status">{note.text}</p>}
      {note?.kind === "error" && <p role="alert" style={{ margin: 0, color: "var(--g-bad)" }}>{note.text}</p>}
      {reloadFailed && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, color: "var(--g-muted)" }}>
          <span>{T.reloadFailed}</span>
          <Button size="sm" variant="tint" disabled={retrying} onClick={() => void retryReload()}>
            {retrying ? T.working : T.retry}
          </Button>
        </div>
      )}
      {load.status === "loading" && <HonestState kind="empty" title={T.loading} />}
      {load.status === "error" && <HonestState kind="offline" title={T.loadFailed} action={{ label: T.retry, onClick: () => void fetchVariants(false) }} />}
      {load.status === "ready" && variants.length === 0 && <HonestState kind="empty" title={T.emptyTitle} hint={T.emptyHint} />}
      {variants.length > 0 && (
        <section className="ps-gallery" aria-label={T.list}>
          {variants.map((v) => (
            <VariantCard key={v.id} variant={v} busy={busy.has(v.id)} onVerdict={(verdict) => void decide(v, verdict)} />
          ))}
        </section>
      )}
    </div>
  );
}
