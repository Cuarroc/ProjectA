import "../../design/controls/controls.css";
import "../../design/glass.css";
import { Button } from "../../design/controls/Button";
import { HonestState } from "../../design/data/HonestState";
import { StateMark } from "../../design/state/StateMark";
import type { StateForm } from "../../design/state/states";
import { PROVIDER_POLL_MS, useProviderOverview } from "../../lib/providers";
import { T } from "./texts";
import "./start.css";

export type StartStepId = "welcome" | "tools" | "subs" | "project" | "team" | "done";

export interface ErsteinrichtungScreenProps {
  /** Whether at least one project exists (the same signal as FirstRunChecklist). */
  hasProject: boolean;
  /** One action per step; the host decides what it opens. */
  onAction: (step: StartStepId) => void;
}

interface Row {
  id: StartStepId;
  title: string;
  detail: string;
  form: StateForm;
  chip: string;
  action: string;
  primary?: boolean;
}

const names = (list: readonly { name: string }[]) => list.map((p) => p.name).join(", ");

/**
 * The six first-run steps as a Glass stepper. Not mounted yet (route `/start`
 * has no sidebar entry). Every state is derived from live data on each render:
 * provider sign-in from the overview, project presence from the caller. The repo
 * scan (V2-B28) has no command yet, so that step says so instead of showing a value.
 */
export function ErsteinrichtungScreen({ hasProject, onAction }: ErsteinrichtungScreenProps) {
  const { providers, loading, error, refresh } = useProviderOverview(PROVIDER_POLL_MS);
  const signedIn = providers.filter((p) => p.connected);
  const ready = signedIn.length > 0;
  const known = providers.length > 0;

  const toolsRow: Pick<Row, "form" | "chip" | "detail"> = loading
    ? { form: "run", chip: T.chip.reading, detail: "" }
    : error
      ? { form: "bad", chip: T.chip.failed, detail: T.readFailed }
      : known
        ? { form: "done", chip: T.chip.done, detail: T.known(names(providers)) }
        : { form: "need", chip: T.chip.open, detail: T.noProviders };
  const subsRow: Pick<Row, "form" | "chip" | "detail"> = loading
    ? { form: "run", chip: T.chip.reading, detail: "" }
    : error
      ? { form: "bad", chip: T.chip.failed, detail: T.readFailed }
      : ready
        ? { form: "done", chip: T.chip.done, detail: T.signedIn(names(signedIn)) }
        : { form: "need", chip: T.chip.open, detail: known ? T.missing(names(providers)) : T.noProviders };

  const rows: Row[] = [
    { id: "welcome", title: T.welcome.title, detail: T.welcome.hint, form: "ok", chip: T.chip.ready, action: T.welcome.action },
    { id: "tools", title: T.tools.title, action: T.tools.action, ...toolsRow },
    { id: "subs", title: T.subs.title, action: T.subs.action, ...subsRow },
    {
      id: "project", title: T.project.title, action: T.project.action,
      detail: hasProject ? T.projectDone : T.projectOpen,
      form: hasProject ? "done" : "need", chip: hasProject ? T.chip.done : T.chip.open,
    },
    { id: "team", title: T.team.title, detail: T.team.hint, form: "need", chip: T.chip.open, action: T.team.action },
    {
      id: "done", title: T.done.title, detail: T.done.hint, action: T.done.action, primary: true,
      form: ready && hasProject ? "ok" : "need", chip: ready && hasProject ? T.chip.ready : T.chip.open,
    },
  ];
  // The first step that is neither ready nor done is "the current one".
  const current = rows.findIndex((r) => r.form === "need" || r.form === "bad" || r.form === "run");

  return (
    <main className="st-screen">
      <header className="st-head">
        <h1>{T.title}</h1>
        <p>{T.lead}</p>
      </header>
      <ol className="st-steps" aria-label={T.steps}>
        {rows.map((r, i) => (
          <li key={r.id} className="g-glass st-step" aria-current={i === current ? "step" : undefined}>
            <span className="st-num" aria-label={T.stepOf(i + 1)}>{i + 1}</span>
            <div className="st-body">
              <h2>{r.title}</h2>
              {r.detail && <p>{r.detail}</p>}
              {r.id === "project" && <HonestState kind="offline" title={T.scanTitle} hint={T.scanHint} />}
            </div>
            <StateMark form={r.form} label={r.chip} />
            <Button variant={r.primary ? "primary" : "secondary"} onClick={() => (r.id === "tools" ? refresh() : onAction(r.id))}>
              {r.action}
            </Button>
          </li>
        ))}
      </ol>
      <p className="st-foot">{T.foot}</p>
    </main>
  );
}
