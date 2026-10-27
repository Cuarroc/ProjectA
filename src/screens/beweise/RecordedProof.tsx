import { useEffect, useState } from "react";
import { Button } from "../../design/controls/Button";
import { KeyValue } from "../../design/data/KeyValue";
import { getDevelopmentRecords } from "../../lib/ipc/developmentRecords";
import { projectRecords, type Observation, type Projection } from "./records/project";
import { T } from "./records/texts";

function ObservationFields({ value }: { value: Observation | null }) {
  return <KeyValue items={[
    { label: T.candidate, value: value?.commit ?? T.unavailable },
    { label: T.source, value: value?.source ?? T.unavailable },
    { label: T.observedAt, value: value?.observedAt == null ? T.unavailable : new Date(value.observedAt * 1000).toISOString() },
  ]} />;
}

/** Mounted only for the selected worker; each keyed route visit owns its reads. */
export function RecordedProof({ projectId, workerId }: { projectId: string; workerId: string }) {
  const [view, setView] = useState<Projection | null>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    setView(undefined);
    getDevelopmentRecords(projectId).then((snapshot) => projectRecords(snapshot.runs, workerId)).then(
      (projection) => { if (live) setView(projection); },
      () => { if (live) setView(null); },
    );
    return () => { live = false; };
  }, [projectId, workerId, revision]);
  const status = view === undefined ? T.loading : view === null ? T.readError
    : !view.projectHasRecords ? T.emptyProject : view.runs.length === 0 ? T.noWorker : null;
  return <section className="g-glass bw-card" aria-label={T.region}>
    <header className="bw-head">
      <h2 className="bw-h">{T.region}</h2>
      <Button size="sm" onClick={() => { setView(undefined); setRevision((n) => n + 1); }}>{T.reload}</Button>
    </header>
    <div role="status">{status && <p className="bw-summary-text">{status}</p>}</div>
    {view?.runs.map((run, index) => <article className="bw-root" key={index}>
      <h3 className="bw-h">{run.state}</h3>
      <section aria-label={T.candidate}>
        <h4 className="bw-h">{T.candidate}</h4>
        <ObservationFields value={run.candidate} />
      </section>
      <section aria-label={T.evidence}>
        <h4 className="bw-h">{T.evidence}</h4>
        {run.evidence.length === 0 ? <p className="bw-note">{T.unavailable}</p> : <ul className="bw-steps">
          {run.evidence.map((entry, i) => <li className="bw-card" key={i}>
            <p className="bw-summary-text">{T.associations[entry.association]}</p>
            <KeyValue items={[{ label: T.measurement, value: entry.measurement ?? T.unavailable }]} />
            <ObservationFields value={entry} />
          </li>)}
        </ul>}
      </section>
      <section aria-label={T.reviews}>
        <h4 className="bw-h">{T.reviews}</h4>
        {run.reviews.length === 0 ? <p className="bw-note">{T.unavailable}</p> : <ul className="bw-steps">
          {run.reviews.map((entry, i) => <li className="bw-card" key={i}>
            <p className="bw-summary-text">{T.associations[entry.association]}</p>
            <p className="bw-note">{entry.attestation === "unverified" ? T.unverified : T.unavailable}</p>
            <p className="bw-note">{T.approvalUnavailable}</p>
            <ObservationFields value={entry} />
          </li>)}
        </ul>}
      </section>
    </article>)}
  </section>;
}
