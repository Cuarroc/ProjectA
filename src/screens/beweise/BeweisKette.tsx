import { useCallback, useEffect, useRef, useState } from "react";
import "../../design/glass.css";
import "../../design/controls/controls.css";
import { Button } from "../../design/controls/Button";
import { HonestState } from "../../design/data/HonestState";
import { KeyValue } from "../../design/data/KeyValue";
import { StateMark } from "../../design/state/StateMark";
import { getWorkerReadiness } from "../../lib/ipc";
import type { ReadinessBlocker, WorkerReadiness } from "../../types";
import { T } from "./texts";
import "./beweise.css";

/** The five fixed steps; each owns the engine blocker codes (`readiness.rs` BlockerCode) listed here. */
const STEPS = [
  { label: T.stepWork, codes: ["agent_running", "dirty"] },
  { label: T.stepSetup, codes: ["setup_failed"] },
  { label: T.stepTests, codes: ["tests_stale"] },
  { label: T.stepReview, codes: ["review_stale", "changes_requested", "comments_open"] },
  { label: T.stepBase, codes: ["base_changed", "conflicting", "git_unsupported"] },
] as const;
const KNOWN: ReadonlySet<string> = new Set(STEPS.flatMap((s) => s.codes));
const short = (sha: string) => sha.slice(0, 7);

function Reason({ b, raw = false }: { b: ReadinessBlocker; raw?: boolean }) {
  return (
    <div className="bw-reason">
      <StateMark form="need" label={T.open} />
      <p className="bw-msg">{raw && b.message.trim() === "" ? T.unknownReason : b.message}</p>
      <p className="bw-next">{b.nextStep}</p>
      {raw && (
        <details className="bw-tech">
          <summary>{T.techCode}</summary>
          <code className="bw-code">{b.code}</code>
        </details>
      )}
    </div>
  );
}

function NotConnected({ label, source }: { label: string; source: string }) {
  return (
    <div className="bw-source" role="region" aria-label={label}>
      <dt>{T.notConnected(label)}</dt>
      <dd>
        <details className="bw-tech">
          <summary>{T.techSource}</summary>
          <p className="bw-note">{source}</p>
        </details>
      </dd>
    </div>
  );
}

/** Proof chain of one worker from the readiness read; read-only, not mounted yet. Writes nothing and never merges. */
export function BeweisKette({ workerId }: { workerId: string }) {
  // `undefined` = not read yet, `null` = the read failed: neither may show a step mark.
  const [ready, setReady] = useState<WorkerReadiness | null | undefined>(undefined);
  // Bumped by every read and by every workerId change/unmount: only the newest call may write.
  const generation = useRef(0);

  const load = useCallback(() => {
    const mine = ++generation.current;
    getWorkerReadiness(workerId).then(
      (r) => mine === generation.current && setReady(r),
      () => mine === generation.current && setReady(null),
    );
  }, [workerId]);

  useEffect(() => {
    setReady(undefined);
    load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  const measured = ready != null && ready.checkedAt > 0 && (ready.readiness === "ready" || ready.readiness === "blocked");
  const byStep = (codes: readonly string[]): ReadinessBlocker[] => (ready?.blockers ?? []).filter((b) => codes.includes(b.code));
  const rest = (ready?.blockers ?? []).filter((b) => !KNOWN.has(b.code));
  const first = ready?.blockers[0];
  const blocked = ready?.readiness === "blocked" || first !== undefined;
  const result = ready === undefined ? T.loading : ready === null ? T.unreadable
    : !measured ? T.unmeasured : blocked ? T.checkBlocked : T.checkReady;

  return (
    <div className="bw-root">
      <header className="bw-head">
        <h1 className="bw-title">{T.title}</h1>
        <Button size="sm" onClick={load}>{T.recheck}</Button>
      </header>
      <section className="g-glass bw-card bw-result" aria-label={T.result} aria-live="polite">
        <h2 className="bw-result-title">{result}</h2>
        {ready === null ? <p className="bw-note">{T.unreadableHint} {T.readAgain}</p> : ready !== undefined && (
          <>
            {!measured && <p className="bw-note">{T.unmeasuredHint}</p>}
            {first ? (
              <>
                <p className="bw-summary-text">{T.firstReason}: {first.message.trim() || T.unknownReason}</p>
                <p className="bw-summary-text">{T.nextStep}: {first.nextStep.trim() || T.clarifyReason}</p>
              </>
            ) : measured && blocked && <p className="bw-summary-text">{T.missingReason} {T.clarifyReason}</p>}
            {measured && <p className="bw-note">{T.checked}: <time dateTime={new Date(ready.checkedAt * 1000).toISOString()}>{new Date(ready.checkedAt * 1000).toLocaleString("de-DE")}</time> · {T.codeStand}: {ready.code ? short(ready.code.workerHeadSha) : T.stepUnmeasured}</p>}
          </>
        )}
        <p className="bw-note">{T.checkScope}</p>
      </section>
      {ready != null && (
        <div className="bw-evidence">
          <section className="g-glass bw-card bw-chain" aria-label={T.title}>
            <ol className="bw-steps">
              {STEPS.map((s) => {
                const hits = byStep(s.codes);
                return (
                  <li key={s.label} className="bw-step" aria-label={s.label}>
                    <h3 className="bw-step-h">{s.label}</h3>
                    {hits.length > 0 ? hits.map((b, i) => <Reason key={`${b.code}-${i}`} b={b} />) : measured ? <StateMark form="ok" label={T.fulfilled} /> : <span className="bw-note">{T.stepUnmeasured}</span>}
                  </li>
                );
              })}
            </ol>
          </section>
          {rest.length > 0 && (
            <section className="g-glass bw-card bw-more" aria-label={T.more}>
              <h2 className="bw-h">{T.more}</h2>
              {rest.map((b, i) => <Reason key={`${b.code}-${i}`} b={b} raw />)}
            </section>
          )}
          <section className="g-glass bw-card bw-code-card" aria-label={T.codeStand}>
            <h2 className="bw-h">{T.codeStand}</h2>
            {ready.code === null ? (
              <HonestState kind="empty" title={T.codeUnmeasured} hint={T.codeUnmeasuredHint} />
            ) : (
              <KeyValue box items={[
                { label: T.workerHead, value: short(ready.code.workerHeadSha) },
                { label: T.baseTip, value: short(ready.code.baseTipSha) },
                { label: T.ahead, value: String(ready.ahead) },
                { label: T.behind, value: String(ready.behind) },
              ]} />
            )}
          </section>
        </div>
      )}
      <section className="g-glass bw-card" aria-label={T.missingSources}>
        <h2 className="bw-h">{T.missingSources}</h2>
        <p className="bw-note">{T.notConnectedHint}</p>
        <dl className="bw-sources">
          <NotConnected label={T.gates} source={T.sourceProof} />
          <NotConnected label={T.review} source={T.sourceReview} />
          <NotConnected label={T.uncovered} source={T.sourceProof} />
          <NotConnected label={T.queue} source={T.sourceQueue} />
        </dl>
      </section>
    </div>
  );
}
