import { useCallback, useEffect, useState } from "react";

import { describeError, listProjects } from "../../lib/ipc";
import { scanSetupRepo } from "../../lib/setupScan";
import ProviderDialog from "../../components/ProviderDialog";
import type { Project } from "../../types";
import { useT } from "../../i18n/useT";
import { ErsteinrichtungScreen, type ScanState, type StartStepId } from "./ErsteinrichtungScreen";

/** Same key the old app writes when it picks a project (the Glass shell has no picker yet). */
const ACTIVE_PROJECT_KEY = "projecta.activeProjectId";
const readProjectId = () => {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY);
  } catch {
    return null;
  }
};

/** Where each step leads: sign-in opens the old provider dialog, adding a project is the old sidebar's "+". */
const STEP_HASH: Partial<Record<StartStepId, string>> = {
  project: "#/leitstand/klassisch",
  team: "#/team",
  done: "#/leitstand",
};

/**
 * `/start` (V2-S11-M): the Ersteinrichtung stepper on live data. The project is the one the old
 * app selected (else the first); its repository is read with the read-only scan (V2-B28).
 */
export default function StartRoute() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [scan, setScan] = useState<ScanState>({ status: "idle" });
  const [providers, setProviders] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const t = useT();
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  useEffect(() => {
    let live = true;
    listProjects().then((list) => live && (setListError(null), setProjects(list)), (cause) => live && (setProjects([]), setListError(describeError(cause))));
    return () => { live = false; };
  }, [attempt]);
  const project = projects.find((p) => p.id === readProjectId()) ?? projects[0] ?? null;
  const path = project?.repoPath ?? null;
  useEffect(() => {
    if (path === null) return setScan({ status: "idle" });
    let live = true;
    setScan({ status: "loading" });
    scanSetupRepo(path).then(
      (result) => live && setScan({ status: "ok", scan: result }),
      (cause) => live && setScan({ status: "error", message: describeError(cause), onRetry: retry }),
    );
    return () => { live = false; };
  }, [path, attempt, retry]);

  // A failed list read forgets the projects, so the scan goes idle and only the list error (with its retry) stays.
  // It outranks the scan: without projects the scan would only say "no project".
  const shown: ScanState = listError === null
    ? scan
    : { status: "error", message: listError, title: t("start.projects.errorTitle"), onRetry: retry };
  const onAction = (step: StartStepId) => {
    if (step === "subs") setProviders(true);
    const hash = STEP_HASH[step];
    if (hash) window.location.hash = hash;
  };
  return (
    <>
      <ErsteinrichtungScreen hasProject={projects.length > 0} scan={shown} onAction={onAction} />
      {providers ? <ProviderDialog onClose={() => setProviders(false)} /> : null}
    </>
  );
}
