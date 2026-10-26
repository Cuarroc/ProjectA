import { useEffect, useState } from "react";
import { Button } from "../../design/controls/Button";
import { HonestState } from "../../design/data/HonestState";
import { Select } from "../../design/inputs/Select";
import { readActiveProjectId, subscribeActiveProject } from "../../lib/activeProject";
import { getBoardState } from "../../lib/ipc";
import type { BoardCard } from "../../types";
import { BeweisKette } from "./BeweisKette";
import { T } from "./route/texts";

/** Each project visit owns its reads, including a return to a previous project. */
function ProjectProof({ projectId }: { projectId: string }) {
  const [cards, setCards] = useState<BoardCard[] | null>();
  const [selected, setSelected] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    setCards(undefined);
    setSelected("");
    getBoardState(projectId).then(
      (board) => { if (live) setCards(board.cards.filter((card) => card.worker.projectId === projectId)); },
      () => { if (live) setCards(null); },
    );
    return () => { live = false; };
  }, [projectId, revision]);
  const card = cards?.find((item) => item.worker.id === selected);
  return <>
    <Button size="sm" disabled={cards === undefined} onClick={() => setRevision((n) => n + 1)}>{T.reload}</Button>
    <div role="status">
      {cards === undefined ? <p>{T.loading}</p> : cards === null
        ? <HonestState kind="offline" title={T.failed} />
        : cards.length === 0 ? <HonestState kind="empty" title={T.empty} /> : null}
    </div>
    {cards && cards.length > 0 && <Select aria-label={T.worker} value={selected} onChange={(event) => setSelected(event.target.value)}>
      <option value="">{T.worker}</option>
      {cards.map(({ worker }) => <option key={worker.id} value={worker.id}>{worker.task}</option>)}
    </Select>}
    {card && <>
      {card.prUrl ? <a href={card.prUrl} target="_blank" rel="noreferrer">{T.pr}</a> : <p>{T.noPr}</p>}
      <p>{T.scope}</p>
      <BeweisKette key={`${projectId}:${card.worker.id}`} workerId={card.worker.id} />
    </>}
  </>;
}

export default function BeweiseRoute() {
  const [project, setProject] = useState(() => ({ id: readActiveProjectId(), visit: 0 }));
  useEffect(() => {
    const update = (id: string | null) => setProject((p) => p.id === id ? p : { id, visit: p.visit + 1 });
    update(readActiveProjectId());
    return subscribeActiveProject(update);
  }, []);
  return <div className="g-lr" style={{ overflowY: "auto" }}><div className="bw-root">
    <div className="g-lr-head"><h1>{T.title}</h1></div>
    <nav className="g-shell-tabs" aria-label={T.tabs}>
      <a href="#/beweise" aria-current="page">{T.main}</a><a href="#/beweise/diff">{T.diff}</a>
    </nav>
    <div className="g-lr-head">
      {[T.gates, T.reviews].map((label) => <section key={label} className="g-glass bw-card" aria-label={label}>
        <h2>{label}</h2><p>{T.unavailable}</p>
      </section>)}
    </div>
    {project.id ? <ProjectProof key={project.visit} projectId={project.id} /> : <div role="status">
      <HonestState kind="empty" title={T.noProject} hint={T.chooseProject} />
      <a href="#/start">{T.setup}</a>
    </div>}
  </div></div>;
}
