import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";

import { Button } from "../../design/controls/Button";
import { ErrorDetails } from "../../errors/ErrorDetails";
import { texts, userError } from "../../errors/texts";
import { cancelUpdateDownload, describeError, installUpdateWhenIdle, listLiveSessions, type CancelUpdateResult } from "../../lib/ipc";
import { T } from "./texts";

type Check =
  | { phase: "idle" | "checking" | "up-to-date" }
  | { phase: "available"; version: string; workers: number; cancelled?: boolean }
  | { phase: "installing"; version: string; cancelling?: boolean; result?: CancelUpdateResult }
  | { phase: "ready"; version: string }
  | { phase: "error"; message: string };

/**
 * Same lib calls and IPC wrappers as the classic Updates tab (`SettingsView`), in a smaller flow.
 * shortcut: no release notes, restart button or `setUpdaterState` sync (the classic tab has them); add when the classic tab goes.
 */
export function VersionUpdates() {
  const [version, setVersion] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [state, setState] = useState<Check>({ phase: "idle" });
  const live = useRef(true); // late lib answers after unmount are dropped
  const update = useRef<Update | null>(null); // the core's download handle
  const attempt = useRef(0); // a cancelled download's late rejection belongs to a dead attempt
  const cancelling = useRef<{ error?: { e: unknown } } | null>(null); // while a cancel is in flight, an install rejection waits for its verdict
  const readVersion = useCallback(() => {
    void getVersion().then(
      (v) => { if (live.current) { setVersion(v); setFailed(false); } },
      () => { if (live.current) setFailed(true); },
    );
  }, []);
  useEffect(() => {
    live.current = true;
    readVersion();
    return () => { live.current = false; };
  }, [readVersion]);
  const fail = (e: unknown) => { if (live.current) setState({ phase: "error", message: describeError(e) }); };
  const run = () => {
    setState({ phase: "checking" });
    readVersion();
    check().then(async (u) => {
      update.current = u === null || !u.available ? null : u;
      // Applying an update relaunches the app and ends every session: only offer it while none runs.
      const workers = u !== null && u.available ? (await listLiveSessions()).length : 0;
      if (live.current) setState(u === null || !u.available ? { phase: "up-to-date" } : { phase: "available", version: u.version, workers });
    }).catch(fail);
  };
  const install = () => {
    const u = update.current;
    if (u === null || state.phase !== "available") return;
    const { version: v } = state;
    const id = ++attempt.current;
    const stale = () => !live.current || id !== attempt.current;
    setState({ phase: "installing", version: v });
    void (async () => {
      try {
        const { length } = await listLiveSessions(); // a session may have started since the check
        if (stale()) return;
        if (length > 0) { setState({ phase: "available", version: v, workers: length }); return; }
        await installUpdateWhenIdle(u.rid);
        if (!stale()) { update.current = null; setState({ phase: "ready", version: v }); }
      } catch (e) {
        if (stale()) return;
        if (cancelling.current) cancelling.current.error = { e }; // the cancel verdict decides whether the abort caused it
        else fail(e);
      }
    })();
  };
  const cancel = () => {
    if (state.phase !== "installing" || state.cancelling) return;
    const { version: v } = state;
    const flight: NonNullable<typeof cancelling.current> = {};
    cancelling.current = flight;
    setState({ ...state, cancelling: true });
    cancelUpdateDownload().then(async (result) => {
      cancelling.current = null;
      // Only a state still installing may change: the install can have finished while this was in flight.
      const still = (next: Check) => { if (live.current) setState((s) => (s.phase === "installing" ? next : s)); };
      if (result === "cancelled") {
        attempt.current += 1; // the aborted download rejects: expected, not an error
        const { length } = await listLiveSessions(); // a session may have started during the download
        still({ phase: "available", version: v, workers: length, cancelled: true });
      } else if (flight.error) {
        fail(flight.error.e); // the install failed by itself: the cancel did not stop it
      } else if (T.cancelResult[result] !== undefined) {
        still({ phase: "installing", version: v, result }); // the install goes on, a late cancel says so
      } // notRunning: stays cancelling (button off) until the install promise settles
    }).catch((e) => { cancelling.current = null; fail(e); });
  };
  const late = state.phase === "installing" && state.result ? T.cancelResult[state.result] : undefined; // a cancel that could not stop the install
  const status =
    state.phase === "up-to-date" ? T.upToDate
    : state.phase === "available" ? `${T.available(state.version)}${state.cancelled ? ` ${T.cancelled}` : ""}`
    : state.phase === "installing" ? (late ?? T.installing(state.version))
    : state.phase === "ready" ? T.ready(state.version)
    : "";
  return (
    <>
      <p className="es-val">{failed ? T.versionOff : `ProjectA ${version ?? "…"}`}</p>
      <Button size="sm" variant="tint" disabled={state.phase === "checking" || state.phase === "installing"} onClick={run}>
        {state.phase === "checking" ? T.checking : T.check}
      </Button>
      <p className="es-note" role="status">{status}</p>
      {state.phase === "available" ? (
        state.workers > 0
          ? <p className="es-note">{T.busy(state.workers)}</p>
          : <Button size="sm" variant="primary" onClick={install}>{T.install}</Button>
      ) : null}
      {state.phase === "installing" && late === undefined ? (
        <Button size="sm" variant="ghost" disabled={state.cancelling} onClick={cancel}>{T.cancel}</Button>
      ) : null}
      {state.phase === "error" ? (
        <div className="es-err" role="alert">
          <p>{userError(state.message, texts.actionFailed).text}</p>
          <ErrorDetails raw={userError(state.message).detail} />
        </div>
      ) : null}
    </>
  );
}
