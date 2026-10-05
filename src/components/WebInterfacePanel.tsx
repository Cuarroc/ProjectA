import { useCallback, useState } from "react";

import {
  describeError,
  getWebInterfaceStatus,
  startWebInterface,
  stopWebInterface,
} from "../lib/ipc";
import { openExternalSafely } from "../lib/openExternalSafely";
import { loadWebPort } from "../lib/settings";
import { useRefreshOnResume } from "../lib/useRefreshOnResume";

/** Fallback when nothing is stored and nothing is running. */
const FALLBACK_PORT = 8787;

/**
 * Start/stop switch for the core's localhost web interface. It is a sidebar
 * control, not a full view: the interface itself opens in a real browser.
 */
export default function WebInterfacePanel() {
  // `null` is "not asked yet": claiming "aus" before the status request
  // answers would be a guess presented as fact.
  const [running, setRunning] = useState<boolean | null>(null);
  const [port, setPort] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const active = await getWebInterfaceStatus();
      setRunning(active !== null);
      setPort(active);
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    }
  }, []);

  // The core or HQ may have changed it while this webview was inactive.
  useRefreshOnResume(refresh);

  const handleStart = () => {
    if (loading) return;
    // The port is chosen in Settings; the sidebar only switches.
    const wanted = loadWebPort() ?? FALLBACK_PORT;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const bound = await startWebInterface(wanted);
        setRunning(true);
        setPort(bound);
      } catch (cause) {
        setError(describeError(cause));
      } finally {
        setLoading(false);
      }
    })();
  };

  const handleStop = () => {
    if (loading) return;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        await stopWebInterface();
        setRunning(false);
        setPort(null);
      } catch (cause) {
        setError(describeError(cause));
      } finally {
        setLoading(false);
      }
    })();
  };

  // The board is the page worth opening from here: the index only lists
  // landing pages, this is who is working and who is stuck.
  const boardUrl = `http://localhost:${port}/board`;

  return (
    <section className="sidebar-section webui-section">
      <div className="webui-row">
        <h2 className="section-title">Web-Ansicht</h2>
        {running && port !== null ? (
          <button
            type="button"
            className="webui-state webui-state-on webui-chip"
            title={`${boardUrl} im Browser öffnen`}
            onClick={() => void openExternalSafely(boardUrl, setError)}
          >
            läuft · {port}
          </button>
        ) : (
          <span className="webui-state">{running === null ? "prüft…" : "aus"}</span>
        )}
        {running ? (
          <button
            type="button"
            className="worker-action webui-stop"
            disabled={loading}
            onClick={handleStop}
          >
            {loading ? "Stoppt…" : "Stoppen"}
          </button>
        ) : (
          <button
            type="button"
            className="button-primary webui-start"
            disabled={loading}
            onClick={handleStart}
          >
            {loading ? "Starte…" : "Starten"}
          </button>
        )}
      </div>

      {error ? <div className="sidebar-note sidebar-error">{error}</div> : null}
    </section>
  );
}
