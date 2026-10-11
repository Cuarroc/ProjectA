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
      {raw && <code className="bw-code">{b.code}</code>}
      <p className="bw-msg">{b.message}</p>
      <p className="bw-next">{b.nextStep}</p>
    </div>
  );
}

function NotConnected({ label, source }: { label: string; source: string }) {
  return (
    <section className="g-glass bw-card" aria-label={label}>
      <h2 className="bw-h">{label}</h2>
      <HonestState kind="offline" title={T.notConnected(label)} hint={T.notConnectedHint} />
      <p className="bw-note">{source}</p>
    </section>
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

  return (
    <div className="bw-root">
      <header className="bw-head">
        <h1 className="bw-title">{T.title}</h1>
        <Button size="sm" onClick={load}>{T.recheck}</Button>
      </header>
      {ready === undefined ? <p className="bw-note">{T.loading}</p> : ready === null ? (
        <HonestState kind="offline" title={T.unreadable} hint={T.unreadableHint} />
      ) : (
        <>
          <section className="g-glass bw-card" aria-label={T.title}>
            {!measured && <HonestState kind="empty" title={T.unmeasured} hint={T.unmeasuredHint} />}
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
            <section className="g-glass bw-card" aria-label={T.more}>
              <h2 className="bw-h">{T.more}</h2>
              {rest.map((b, i) => <Reason key={`${b.code}-${i}`} b={b} raw />)}
            </section>
          )}
          <section className="g-glass bw-card" aria-label={T.codeStand}>
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
        </>
      )}
      <div className="bw-grid">
        <NotConnected label={T.gates} source={T.sourceProof} />
        <NotConnected label={T.review} source={T.sourceReview} />
        <NotConnected label={T.uncovered} source={T.sourceProof} />
        <NotConnected label={T.queue} source={T.sourceQueue} />
      </div>
    </div>
  );
}
