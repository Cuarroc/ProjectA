import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";

import { Button } from "../../design/controls/Button";
import { describeError } from "../../lib/ipc";
import { T } from "./texts";

type Check = { phase: "idle" | "checking" | "up-to-date" } | { phase: "available"; version: string } | { phase: "error"; message: string };

/** Same lib calls as the classic Updates tab (`getVersion`, `check`); installing stays there until a later slice. */
export function VersionUpdates() {
  const [version, setVersion] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [state, setState] = useState<Check>({ phase: "idle" });
  useEffect(() => { void getVersion().then(setVersion, () => setFailed(true)); }, []);
  const run = () => {
    setState({ phase: "checking" });
    check().then(
      (u) => setState(u === null || !u.available ? { phase: "up-to-date" } : { phase: "available", version: u.version }),
      (e: unknown) => setState({ phase: "error", message: describeError(e) }),
    );
  };
  return (
    <>
      <p className="es-val">{failed ? T.versionOff : `ProjectA ${version ?? "…"}`}</p>
      <Button size="sm" variant="tint" disabled={state.phase === "checking"} onClick={run}>
        {state.phase === "checking" ? T.checking : T.check}
      </Button>
      <p className="es-note" role="status">
        {state.phase === "up-to-date" ? T.upToDate : state.phase === "available" ? T.available(state.version) : ""}
      </p>
      {state.phase === "error" ? <p className="es-err" role="alert">{state.message}</p> : null}
    </>
  );
}
