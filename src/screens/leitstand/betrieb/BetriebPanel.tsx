import { useEffect, useState } from "react";
import "../../../design/glass.css";
import { HonestState } from "../../../design/data/HonestState";
import { KeyValue } from "../../../design/data/KeyValue";
import { StateMark } from "../../../design/state/StateMark";
import type { StateForm } from "../../../design/state/states";
import { getResourceSnapshot, getWatchdogReport, listQueue, type ResourceSnapshot, type WatchdogFinding } from "../../../lib/ipc";
import { shortTask } from "../../../lib/text";
import type { AgentProfile, QueueEntry, QueueEntryStatus } from "../../../types";
import { T } from "./texts";
import "./betrieb.css";

export interface BetriebPanelProps {
  projectId: string;
  profiles: readonly AgentProfile[];
}

/** Waiting stages have no state form of their own; they borrow the shape of "in Prüfung" and print their own word. */
const STATUS: Record<QueueEntryStatus, { form: StateForm; label?: string }> = {
  queued: { form: "rev", label: T.statusQueued },
  sharpening: { form: "run", label: T.statusSharpening },
  ready: { form: "rev", label: T.statusReady },
  dispatching: { form: "run", label: T.statusDispatching },
  dispatched: { form: "run" },
  done: { form: "done" },
  failed: { form: "bad" },
};

const gb = (bytes: number) => T.gigabytes((bytes / 1024 ** 3).toLocaleString("de-DE", { maximumFractionDigits: 1 }));
const POLL_MS = 10_000;

/** Betrieb: queue, start check and watchdog, read-only. Nothing here starts, stops or dispatches anything; not mounted yet. */
export function BetriebPanel({ projectId, profiles }: BetriebPanelProps) {
  // `undefined` = not read yet, `null` = the read failed: neither may claim "empty" or show a number.
  const [queue, setQueue] = useState<readonly QueueEntry[] | null | undefined>(undefined);
  const [resources, setResources] = useState<ResourceSnapshot | null | undefined>(undefined);
  // `string` = the read failed and this is the core's sentence.
  const [dog, setDog] = useState<readonly WatchdogFinding[] | string | undefined>(undefined);

  useEffect(() => {
    let live = true;
    setQueue(undefined);
    setResources(undefined);
    setDog(undefined);
    const read = () => {
      listQueue(projectId).then((rows) => live && setQueue(Array.isArray(rows) ? rows : null), () => live && setQueue(null));
      getResourceSnapshot().then((r) => live && setResources(r), () => live && setResources(null));
      getWatchdogReport(projectId).then((f) => live && setDog(f), (e) => live && setDog(String(e instanceof Error ? e.message : e).trim() || T.watchdogOffline));
    };
    read();
    const timer = window.setInterval(read, POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [projectId]);

  const nameOf = (id: string | null) => (id === null ? T.autoProfile : profiles.find((p) => p.id === id)?.name ?? id);
  const ram = resources?.ramProcessBytes != null && resources.ramTotalBytes != null
    ? { used: resources.ramProcessBytes, total: resources.ramTotalBytes }
    : null;

  return (
    <div className="bt-panel">
      <section className="g-glass bt-card bt-queue" aria-label={T.queue}>
        <h2 className="bt-h">{T.queue}</h2>
        {queue === undefined ? <p className="bt-note">{T.loading}</p> : queue === null ? (
          <HonestState kind="offline" title={T.queueOffline} hint={T.queueOfflineHint} />
        ) : queue.length === 0 ? (
          <HonestState kind="empty" title={T.queueEmpty} hint={T.queueEmptyHint} />
        ) : (
          <ul className="bt-list">
            {queue.map((e) => (
              <li key={e.id} className="bt-row">
                <StateMark form={STATUS[e.status].form} label={STATUS[e.status].label} />
                <span className="bt-task" title={e.rawText}>{shortTask(e.rawText, 80)}</span>
                <span className="bt-profile">{nameOf(e.profileId)}</span>
                {e.error?.trim() ? <p className="bt-reason">{e.error}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="g-glass bt-card" aria-label={T.check}>
        <h2 className="bt-h">{T.check}</h2>
        <HonestState kind="offline" title={T.slotsOffline} hint={T.slotsHint} />
        {resources === undefined ? <p className="bt-note">{T.loading}</p> : ram ? (
          <KeyValue box items={[{ label: T.ramOfApp, value: T.ramOf(gb(ram.used), gb(ram.total)) }]} />
        ) : (
          <HonestState kind="offline" title={T.ramOffline} hint={T.ramHint} />
        )}
      </section>
      <section className="g-glass bt-card" aria-label={T.watchdog}>
        <h2 className="bt-h">{T.watchdog}</h2>
        {dog === undefined ? <p className="bt-note">{T.loading}</p> : typeof dog === "string" ? (
          <HonestState kind="offline" title={dog} hint={T.watchdogOfflineHint} />
        ) : dog.length === 0 ? (
          <HonestState kind="empty" title={T.watchdogEmpty} hint={T.watchdogEmptyHint} />
        ) : (
          <ul className="bt-list">
            {dog.map((f) => (
              <li key={`${f.runId}-${f.kind}`} className="bt-row bt-find">
                <StateMark form={f.kind === "steht" ? "need" : "done"} />
                <span className="bt-task" title={f.label}>{f.label}</span>
                <p className="bt-reason bt-sentence">{f.sentence}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
