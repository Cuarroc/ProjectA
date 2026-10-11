import { useEffect, useState } from "react";

import { Button } from "../../design/controls/Button";
import {
  describeError,
  exportDiagnosis,
  getLogPath,
  getPanicNotice,
  getReasonCatalog,
  revealLogPath,
  type ReasonExplanation,
} from "../../lib/ipc";
import { T } from "./texts";

/** One read of the core: still loading, answered, or not answerable (no desktop app, IPC error). */
type Read<V> = { s: "loading" } | { s: "ok"; v: V } | { s: "off" };

const LOADING: Read<never> = { s: "loading" };

/** Same IPC as the classic DiagnosticsPanel; every read fails on its own, so one gap never blanks the rest. */
export function DiagnoseSection() {
  const [path, setPath] = useState<Read<string>>(LOADING);
  const [crash, setCrash] = useState<Read<string | null>>(LOADING);
  const [catalog, setCatalog] = useState<Read<ReasonExplanation[]>>(LOADING);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const [exp, setExp] = useState<"idle" | "busy" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true; // a late answer after unmount is dropped
    const take = <V,>(read: Promise<V>, set: (r: Read<V>) => void) =>
      void read.then(
        (v) => { if (live) set({ s: "ok", v }); },
        () => { if (live) set({ s: "off" }); },
      );
    take(getLogPath(), setPath);
    take(getPanicNotice().then((n) => n.current ?? n.previous), setCrash);
    take(getReasonCatalog(), setCatalog);
    return () => { live = false; };
  }, []);

  const pathText = path.s === "ok" ? path.v : null;
  const copyPath = () => {
    if (!pathText) return;
    navigator.clipboard.writeText(pathText).then(() => setCopy("copied"), () => setCopy("failed"));
  };
  const reveal = () => revealLogPath().then(() => setError(null), (e: unknown) => setError(describeError(e)));
  const download = async () => {
    setExp("busy");
    try {
      const url = URL.createObjectURL(new Blob([await exportDiagnosis()], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "projecta-diagnosis.json";
      link.click();
      URL.revokeObjectURL(url);
      setExp("saved");
      setError(null);
    } catch (e) {
      setExp("idle");
      setError(describeError(e));
    }
  };

  return (
    <>
      {crash.s === "off" ? <p className="es-note">{T.crashOff}</p> : null}
      {crash.s === "ok" && crash.v ? (
        <div role="status" className="es-crash">
          <p className="es-val">{T.crash}</p>
          <pre className="es-pre">{crash.v}</pre>
        </div>
      ) : null}
      <p className="es-val">{T.logPath}</p>
      <p className="es-path" data-testid="log-path">{path.s === "off" ? T.diagOff : (pathText ?? "…")}</p>
      <div className="es-row">
        <Button size="sm" disabled={!pathText} onClick={copyPath}>{copy === "copied" ? T.copied : T.copy}</Button>
        <Button size="sm" disabled={!pathText} onClick={() => void reveal()}>{T.reveal}</Button>
        <Button size="sm" variant="tint" disabled={exp === "busy"} onClick={() => void download()}>
          {exp === "busy" ? T.exporting : T.export}
        </Button>
      </div>
      <p className="es-note" role="status">{copy === "failed" ? T.copyFailed : exp === "saved" ? T.exported : ""}</p>
      {error ? <p className="es-err" role="alert">{error}</p> : null}
      {catalog.s === "off" ? <p className="es-note">{T.whyOff}</p> : null}
      {catalog.s === "loading" ? <p className="es-note">…</p> : null}
      {catalog.s === "ok" ? (
        <details className="es-why">
          <summary>{T.why(catalog.v.length)}</summary>
          {catalog.v.length === 0 ? <p className="es-note">{T.whyEmpty}</p> : (
            <ul>
              {catalog.v.map((r) => (
                <li key={r.code}><code>{r.code}</code> <b>{T.grades[r.grade]}</b> {r.line}</li>
              ))}
            </ul>
          )}
        </details>
      ) : null}
    </>
  );
}
