import { useEffect, useState } from "react";
import "../../../design/glass.css";
import { HonestState } from "../../../design/data/HonestState";
import { KeyValue } from "../../../design/data/KeyValue";
import { StateMark } from "../../../design/state/StateMark";
import type { StateForm } from "../../../design/state/states";
import { getResourceSnapshot, listQueue, type ResourceSnapshot } from "../../../lib/ipc";
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

/** Betrieb: queue, start check and watchdog, read-only. Nothing here starts or dispatches anything; not mounted yet. */
export function BetriebPanel({ projectId, profiles }: BetriebPanelProps) {
  // `undefined` = not read yet, `null` = the read failed: neither may claim "empty" or show a number.
  const [queue, setQueue] = useState<readonly QueueEntry[] | null | undefined>(undefined);
  const [resources, setResources] = useState<ResourceSnapshot | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    setQueue(undefined);
    setResources(undefined);
    const read = () => {
      listQueue(projectId).then((rows) => live && setQueue(Array.isArray(rows) ? rows : null), () => live && setQueue(null));
      getResourceSnapshot().then((r) => live && setResources(r), () => live && setResources(null));
    };
    read();
    const timer = window.setInterval(read, POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [projectId]);

  const nameOf = (id: string | null) => (id === null ? T.autoProfile : profiles.find((p) => p.id === id)?.name ?? id);
  const ramKnown = resources?.ramProcessBytes != null && resources.ramTotalBytes != null;

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
        {resources === undefined ? <p className="bt-note">{T.loading}</p> : ramKnown ? (
          <KeyValue box items={[{ label: T.ramOfApp, value: T.ramOf(gb(resources!.ramProcessBytes!), gb(resources!.ramTotalBytes!)) }]} />
        ) : (
          <HonestState kind="offline" title={T.ramOffline} hint={T.ramHint} />
        )}
      </section>
      <section className="g-glass bt-card" aria-label={T.watchdog}>
        <h2 className="bt-h">{T.watchdog}</h2>
        <HonestState kind="offline" title={T.watchdogOffline} hint={T.watchdogHint} />
        <p className="bt-note">{T.watchdogRef}</p>
      </section>
    </div>
  );
}
