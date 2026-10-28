import { useCallback, useEffect, useRef, useState } from "react";

import "../../design/controls/controls.css";
import "../../design/glass.css";
import { Button } from "../../design/controls/Button";
import { Chip } from "../../design/controls/Chip";
import { Field } from "../../design/forms/Field";
import { Textarea } from "../../design/inputs/Input";
import { HonestState } from "../../design/data/HonestState";
import { approveLearning, listLearnings, rejectLearning } from "../../lib/ipc";
import { usePolledResource } from "../../lib/usePolledResource";
import type { Learning } from "../../types";
import { T } from "./texts";
import "./lektionen.css";

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; entries: Learning[] };

function openLessons(all: Learning[], decided: ReadonlySet<string>): Learning[] {
  return all.filter((entry) => entry.status === "pending" && !decided.has(entry.id));
}

/**
 * The approval half of the critic's inbox: pending lessons, each taken into the
 * playbook or thrown away. Read once per project and again after every verdict;
 * nothing polls.
 */
export function LektionenFreigabe({ projectId }: { projectId: string | null }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [readFailure, setReadFailure] = useState(false);
  const begin = usePolledResource(projectId);
  // Bumped on every project change; a plain id would be accepted again after p1 -> p2 -> p1.
  const epoch = useRef(0);
  const decided = useRef<Set<string>>(new Set());
  const acceptRead = useCallback((all: Learning[]) => {
    const entries = openLessons(all, decided.current);
    setDrafts((cur) => Object.fromEntries(entries.map((entry) => [entry.id, cur[entry.id] ?? entry.content])));
    setLoad({ status: "ready", entries });
    setReadFailure(false);
  }, []);

  const refresh = useCallback(async () => {
    if (projectId === null) return;
    const request = begin(true);
    if (request === null) return;
    try {
      const all = await listLearnings(projectId);
      if (request.current()) {
        acceptRead(all);
      }
    } catch {
      if (request.current()) setLoad({ status: "error" });
    } finally {
      request.finish();
    }
  }, [acceptRead, begin, projectId]);

  const reread = useCallback(async () => {
    if (projectId === null) return;
    const token = epoch.current;
    const request = begin(true);
    if (request === null) return;
    try {
      const all = await listLearnings(projectId);
      if (token === epoch.current && request.current()) {
        acceptRead(all);
      }
    } catch {
      if (token === epoch.current && request.current()) setReadFailure(true);
    } finally {
      request.finish();
    }
  }, [acceptRead, begin, projectId]);

  useEffect(() => {
    epoch.current += 1;
    decided.current.clear();
    setLoad({ status: "loading" });
    setBusy(new Set());
    setDrafts({});
    setNotice(null);
    setFailure(null);
    setReadFailure(false);
    void refresh();
    return () => { epoch.current += 1; };
  }, [refresh]);

  const decide = async (id: string, act: () => Promise<void>, done: string, failed: string) => {
    const token = epoch.current;
    const live = () => epoch.current === token;
    setBusy((cur) => new Set(cur).add(id));
    setFailure(null);
    try {
      await act();
      if (!live()) return;
      decided.current.add(id);
      setDrafts((cur) => { const next = { ...cur }; delete next[id]; return next; });
      setNotice(done);
      setLoad((cur) => (cur.status === "ready" ? { status: "ready", entries: cur.entries.filter((entry) => entry.id !== id) } : cur));
      await reread();
    } catch {
      if (live()) {
        setNotice(null);
        setFailure(failed);
      }
    } finally {
      // A verdict that outlives a project switch must not free a row of the new one.
      if (live()) setBusy((cur) => { const next = new Set(cur); next.delete(id); return next; });
    }
  };
  return (
    <section className="lk" aria-label={T.title}>
      <header className="lk-top">
        <h2>{T.title}</h2>
        <p>{T.hint}</p>
      </header>
      <div className="lk-msgs">
        <p className="lk-note" role="status">{notice}</p>
        {failure ? <p className="lk-err" role="alert">{failure}</p> : null}
        {readFailure ? (
          <div className="lk-reread">
            <p className="lk-err" role="alert">{T.reloadFailed}</p>
            <Button size="sm" variant="ghost" onClick={() => void reread()}>{T.retry}</Button>
          </div>
        ) : null}
      </div>
      {projectId === null ? (
        <HonestState kind="empty" title={T.noProject} />
      ) : load.status === "loading" ? (
        <p className="lk-note">{T.loading}</p>
      ) : load.status === "error" ? (
        <HonestState kind="offline" title={T.loadFailed} action={{ label: T.retry, onClick: () => { setLoad({ status: "loading" }); void refresh(); } }} />
      ) : load.entries.length === 0 ? (
        readFailure ? null : <HonestState kind="empty" title={T.empty} />
      ) : (
        <ul className="lk-list">
          {load.entries.map((entry) => {
            const working = busy.has(entry.id);
            const draft = drafts[entry.id] ?? entry.content;
            const text = draft.trim();
            return (
              <li key={entry.id} className="g-glass lk-row" aria-busy={working}>
                <Chip>{entry.patternLabel ?? T.noPattern}</Chip>
                <Field label={T.edit}>{(control) => <Textarea {...control} value={draft} disabled={working} onChange={(event) => setDrafts((cur) => ({ ...cur, [entry.id]: event.target.value }))} />}</Field>
                <div className="lk-actions">
                  {working ? <span className="lk-note">{T.working}</span> : null}
                  <Button size="sm" variant="tint" disabled={working || !text} onClick={() => { if (text) void decide(entry.id, () => approveLearning(entry.id, text), T.approved, T.approveFailed); }}>{T.approve}</Button>
                  <Button size="sm" variant="ghost" disabled={working} onClick={() => void decide(entry.id, () => rejectLearning(entry.id), T.rejected, T.rejectFailed)}>{T.reject}</Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
