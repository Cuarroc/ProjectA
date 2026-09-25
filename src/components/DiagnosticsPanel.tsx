import { useCallback, useEffect, useState } from "react";

import {
  describeError,
  exportDiagnosis,
  getLogPath,
  getPanicNotice,
  getReasonCatalog,
  revealLogPath,
  type PanicNotice,
  type ReasonExplanation,
} from "../lib/ipc";

/**
 * P2-H: log path, diagnosis pack, and a Warum-view that explains every
 * F1-Attention reason-code. The catalog comes from the core so a new code
 * cannot ship without a line.
 */
export default function DiagnosticsPanel() {
  const [logPath, setLogPath] = useState<string | null>(null);
  const [panic, setPanic] = useState<PanicNotice>({ current: null, previous: null });
  const [catalog, setCatalog] = useState<ReasonExplanation[]>([]);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [exportState, setExportState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getLogPath(), getPanicNotice(), getReasonCatalog()])
      .then(([path, notice, reasons]) => {
        if (cancelled) return;
        setLogPath(path);
        setPanic(notice);
        setCatalog(reasons);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(describeError(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const copyPath = useCallback(async () => {
    if (!logPath) return;
    try {
      await navigator.clipboard.writeText(logPath);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }, [logPath]);

  const reveal = useCallback(async () => {
    try {
      await revealLogPath();
      setError(null);
    } catch (err) {
      setError(describeError(err));
    }
  }, []);

  const downloadPack = useCallback(async () => {
    setExportState("saving");
    try {
      const json = await exportDiagnosis();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "projecta-diagnosis.json";
      link.click();
      URL.revokeObjectURL(url);
      setExportState("saved");
      setError(null);
    } catch (err) {
      setExportState("failed");
      setError(describeError(err));
    }
  }, []);

  const panicText = panic.current ?? panic.previous;

  return (
    <div className="diagnose-panel">
      {panicText ? (
        <section className="diagnose-panic" role="status">
          <h2>Der letzte Lauf ist abgestürzt</h2>
          <p>
            ProjectA hat beim Start einen Panic-Marker gefunden. Der Inhalt ist
            unten; das Diagnosepaket nimmt ihn mit, wenn du es exportierst.
          </p>
          <pre className="diagnose-pre">{panicText}</pre>
        </section>
      ) : null}

      <section>
        <h2>Logdatei</h2>
        <p className="diagnose-lede">
          Ohne dass jemand <code>%APPDATA%</code> kennen muss. Kopieren oder im
          Explorer öffnen.
        </p>
        <p className="diagnose-path" data-testid="log-path">
          {logPath ?? "…"}
        </p>
        <div className="diagnose-actions">
          <button type="button" onClick={() => void copyPath()} disabled={!logPath}>
            {copyState === "copied" ? "Kopiert" : "Pfad kopieren"}
          </button>
          <button type="button" onClick={() => void reveal()} disabled={!logPath}>
            Im Explorer zeigen
          </button>
          <button
            type="button"
            onClick={() => void downloadPack()}
            disabled={exportState === "saving"}
          >
            {exportState === "saving"
              ? "Exportiere…"
              : exportState === "saved"
                ? "Paket gespeichert"
                : "Diagnosepaket exportieren"}
          </button>
        </div>
      </section>

      <section>
        <h2>Warum?</h2>
        <p className="diagnose-lede">
          Jeder Reason-Code aus F1-Attention, mit Blockadegrad und dem Satz den
          der Kern dazu sagt. Ein Code ohne Zeile hier wäre ein Fehlschlag.
        </p>
        <table className="diagnose-table">
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Grad</th>
              <th scope="col">Erklärung</th>
            </tr>
          </thead>
          <tbody>
            {catalog.map((entry) => (
              <tr key={entry.code}>
                <td>
                  <code>{entry.code}</code>
                </td>
                <td>{entry.grade}</td>
                <td>{entry.line}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {error ? (
        <p className="diagnose-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
