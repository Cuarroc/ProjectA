import "../../design/controls/controls.css";
import "../../design/glass.css";
import { Button } from "../../design/controls/Button";
import { HonestState } from "../../design/data/HonestState";
import { StateMark } from "../../design/state/StateMark";
import type { StateForm } from "../../design/state/states";
import { useT } from "../../i18n/useT";
import { PROVIDER_POLL_MS, useProviderOverview } from "../../lib/providers";
import type { SetupScan } from "../../lib/setupScan";
import { currentStepIndex } from "./current";
import { T } from "./texts";
import "./start.css";

export type StartStepId = "welcome" | "tools" | "subs" | "project" | "team" | "done";

/** State of the repo scan of the selected project; the host reads it, the screen only shows it. */
export type ScanState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; scan: SetupScan }
  | { status: "error"; message: string };

export interface ErsteinrichtungScreenProps {
  /** Whether at least one project exists (the same signal as FirstRunChecklist). */
  hasProject: boolean;
  /** Repo scan of the selected project; absent keeps the "not connected" note. */
  scan?: ScanState;
  /**
   * One action per step; the host decides what it opens. Every button reports
   * its step, the tools button too (it also re-reads the provider overview).
   */
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

function ScanResult({ scan }: { scan: ScanState }) {
  const t = useT();
  if (scan.status === "idle") return <HonestState kind="empty" title={t("start.scan.idleTitle")} hint={t("start.scan.idleHint")} />;
  if (scan.status === "loading") return <HonestState kind="empty" title={t("start.scan.reading")} />;
  if (scan.status === "error") return <HonestState kind="offline" title={t("start.scan.errorTitle")} hint={scan.message} />;
  const { mainBranch, hasGatesSh, hasMergify, hasAgentsMd } = scan.scan;
  const items: [string, boolean][] = [
    [mainBranch ? t("start.scan.branch").replace("{name}", mainBranch) : t("start.scan.branchMissing"), mainBranch !== null],
    [t("start.scan.gates"), hasGatesSh],
    [t("start.scan.mergify"), hasMergify],
    [t("start.scan.agents"), hasAgentsMd],
  ];
  return (
    <ul className="st-scan" aria-label={t("start.scan.aria")}>
      {items.map(([label, found]) => (
        <li key={label}>
          <span>{label}</span>
          <StateMark form={found ? "done" : "need"} label={found ? t("start.scan.found") : t("start.scan.missing")} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The six first-run steps as a Glass stepper, mounted at `/start` (no sidebar
 * entry). Every state is derived from live data on each render: provider sign-in
 * from the overview, project presence and the repo scan from the caller. Without
 * a `scan` prop the project step says "not connected" instead of showing a value.
 */
export function ErsteinrichtungScreen({ hasProject, scan, onAction }: ErsteinrichtungScreenProps) {
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

  const projectDone = hasProject && (!scan || scan.status === "ok");
  const projectRow: Pick<Row, "form" | "chip"> =
    scan?.status === "error" ? { form: "bad", chip: T.chip.failed }
    : scan?.status === "loading" ? { form: "run", chip: T.chip.reading }
    : projectDone ? { form: "done", chip: T.chip.done }
    : { form: "need", chip: T.chip.open };

  const rows: Row[] = [
    { id: "welcome", title: T.welcome.title, detail: T.welcome.hint, form: "ok", chip: T.chip.ready, action: T.welcome.action },
    { id: "tools", title: T.tools.title, action: T.tools.action, ...toolsRow },
    { id: "subs", title: T.subs.title, action: T.subs.action, ...subsRow },
    {
      id: "project", title: T.project.title, action: T.project.action,
      detail: hasProject ? T.projectDone : T.projectOpen, ...projectRow,
    },
    { id: "team", title: T.team.title, detail: T.team.hint, form: "need", chip: T.chip.open, action: T.team.action },
    {
      id: "done", title: T.done.title, detail: T.done.hint, action: T.done.action, primary: true,
      form: ready && hasProject ? "ok" : "need", chip: ready && hasProject ? T.chip.ready : T.chip.open,
    },
  ];
  const current = currentStepIndex(rows.map((r) => r.form));

  return (
    <div className="st-screen">
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
              {r.id === "project" && (scan ? <ScanResult scan={scan} /> : <HonestState kind="offline" title={T.scanTitle} hint={T.scanHint} />)}
            </div>
            <StateMark form={r.form} label={r.chip} />
            <Button variant={r.primary ? "primary" : "secondary"} onClick={() => {
              if (r.id === "tools") refresh();
              onAction(r.id);
            }}>
              {r.action}
            </Button>
          </li>
        ))}
      </ol>
      <p className="st-foot">{T.foot}</p>
    </div>
  );
}
