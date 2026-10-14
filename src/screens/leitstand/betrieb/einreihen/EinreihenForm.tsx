import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from "react";
import "../../../../design/controls/controls.css";
import "../../../../design/glass.css";
import "../../../../design/inputs/inputs.css";
import { Button } from "../../../../design/controls/Button";
import { Switch } from "../../../../design/controls/Switch";
import { Select } from "../../../../design/inputs/Select";
import { Textarea } from "../../../../design/inputs/Input";
import { cancelQueuedTask, describeError, enqueueTask, getEmergencyStop } from "../../../../lib/ipc";
import { shortTask } from "../../../../lib/text";
import type { AgentProfile, QueueEntry } from "../../../../types";
import { T } from "./texts";

export interface EinreihenFormProps {
  projectId: string;
  profiles: readonly AgentProfile[];
  /** The project's queue as the host reads it; only entries nobody has picked up get a cancel button. */
  entries: readonly QueueEntry[];
  onEnqueued?: (entry: QueueEntry) => void;
  onCancelled?: (id: string) => void;
}

// No stylesheet of its own (the lane owns three files): layout from --g-* tokens only.
const flex = (gap: number, extra: CSSProperties = {}): CSSProperties => ({ display: "flex", gap, ...extra });
const note: CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.4, color: "var(--g-muted)" };
const S = {
  root: flex(12, { flexDirection: "column", padding: 16, fontFamily: "var(--g-font-sans)", color: "var(--g-ink)", minWidth: 0 }),
  entry: flex(12, { alignItems: "center", justifyContent: "space-between", paddingBlock: 8, borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: "var(--g-hair)", fontSize: 13 }),
  task: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
} satisfies Record<string, CSSProperties>;

/** Adds a task to the project's queue and removes one that has not started; the sharpening question loop stays in the old panel. */
export function EinreihenForm({ projectId, profiles, entries, onEnqueued, onCancelled }: EinreihenFormProps) {
  const [task, setTask] = useState("");
  const [profileId, setProfileId] = useState("");
  const [sharpen, setSharpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // `null` = Not-Aus has not been read yet. Unreadable or active stays blocked; only an explicit false opens the gate.
  const [stopped, setStopped] = useState<boolean | null>(null);
  const ids = useId();

  // A write that finishes after a project switch must not publish rows, errors or busy state under the new project.
  // A counter, not the id: a round trip p1 -> p2 -> p1 must still void the first visit's replies.
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    setTask(""); setProfileId(""); setSharpen(false); setSubmitting(false); setCancellingId(null); setError(null);
    return () => { generation.current += 1; };
  }, [projectId]);

  useEffect(() => {
    let live = true;
    const read = () => { getEmergencyStop().then((v) => live && setStopped(v !== false), () => live && setStopped(true)); };
    read();
    const timer = window.setInterval(read, 5000);
    return () => { live = false; window.clearInterval(timer); };
  }, []);

  const text = task.trim();
  const reason = stopped === null ? T.reasonStopPending : stopped ? T.reasonStopped : submitting ? T.reasonBusy : text === "" ? T.reasonEmpty : null;

  /** Runs one write; its outcome only counts while the project it started in is still shown. */
  const write = <V,>(call: Promise<V>, ok: (value: V) => void, failed: (detail: string) => string, done: () => void) => {
    const started = generation.current;
    setError(null);
    call.then(
      (value) => { if (generation.current === started) { done(); ok(value); } },
      (cause) => { if (generation.current === started) { done(); setError(failed(describeError(cause))); } },
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (reason !== null) return;
    setSubmitting(true);
    write(
      enqueueTask({ projectId, rawText: text, profileId: profileId === "" ? undefined : profileId, sharpen }),
      (entry) => { setTask(""); setSharpen(false); onEnqueued?.(entry); },
      T.enqueueFailed, () => setSubmitting(false),
    );
  };

  const cancel = (id: string) => {
    setCancellingId(id);
    write(cancelQueuedTask(id), () => onCancelled?.(id), T.cancelFailed, () => setCancellingId(null));
  };

  // A claimed entry is already starting its worker; the core refuses to cancel it, so no button.
  const waiting = entries.filter((e) => e.status === "queued" || e.status === "ready");

  return (
    <section className="g-glass" style={S.root} aria-label={T.title}>
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{T.title}</h2>
      <form style={flex(12, { flexDirection: "column" })} onSubmit={submit}>
        <Textarea name="einreihen-task" rows={3} aria-label={T.task} placeholder={T.taskPlaceholder} value={task} disabled={submitting} onChange={(e) => setTask(e.target.value)} />
        <Select name="einreihen-profile" aria-label={T.profile} value={profileId} disabled={submitting} onChange={(e) => setProfileId(e.target.value)}>
          <option value="">{T.profileAuto}</option>
          {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <div style={flex(8, { alignItems: "center" })} title={T.sharpenHint}>
          <Switch checked={sharpen} disabled={submitting} aria-labelledby={`${ids}s`} onCheckedChange={setSharpen} />
          <span id={`${ids}s`} style={{ fontSize: 13 }}>{T.sharpen}</span>
        </div>
        <div style={flex(12, { alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" })}>
          <p id={`${ids}r`} style={{ ...note, flex: 1 }}>{reason}</p>
          <Button type="submit" variant="primary" disabled={reason !== null} aria-describedby={reason === null ? undefined : `${ids}r`}>
            {submitting ? T.submitting : T.submit}
          </Button>
        </div>
        {error ? <p role="alert" style={{ ...note, color: "var(--g-bad)", overflowWrap: "anywhere" }}>{error}</p> : null}
      </form>
      {waiting.length === 0 ? null : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {waiting.map((e) => (
            <li key={e.id} style={S.entry}>
              <span style={S.task} title={e.rawText}>{shortTask(e.rawText, 56)}</span>
              <Button size="sm" variant="ghost" disabled={cancellingId === e.id} aria-label={T.cancelOne(shortTask(e.rawText, 56))} onClick={() => cancel(e.id)}>
                {cancellingId === e.id ? T.cancelling : T.cancel}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
