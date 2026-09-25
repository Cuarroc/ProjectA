import { useCallback, useEffect, useState, type FormEvent } from "react";

import {
  describeError,
  getWebInterfaceStatus,
  startWebInterface,
  stopWebInterface,
} from "../lib/ipc";
import { openExternalSafely } from "../lib/openExternalSafely";
import { loadWebPort } from "../lib/settings";

/** Fallback when nothing is stored and nothing is running. */
const FALLBACK_PORT = "8787";

function initialPortInput(): string {
  const stored = loadWebPort();
  return stored === null ? FALLBACK_PORT : String(stored);
}

/**
 * Start/stop switch for the core's localhost web interface. It is a sidebar
 * control, not a full view: the interface itself opens in a real browser.
 */
export default function WebInterfacePanel() {
  // `null` is "not asked yet": claiming "aus" before the status request
  // answers would be a guess presented as fact.
  const [running, setRunning] = useState<boolean | null>(null);
  const [port, setPort] = useState<number | null>(null);
  const [inputPort, setInputPort] = useState(initialPortInput);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const active = await getWebInterfaceStatus();
      setRunning(active !== null);
      setPort(active);
      if (active !== null) setInputPort(String(active));
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    }
  }, []);

  // The core may have started or stopped it on its own between sessions.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleStart = (event: FormEvent) => {
    event.preventDefault();
    const wanted = Number.parseInt(inputPort.trim(), 10);
    if (!Number.isInteger(wanted) || wanted < 1 || wanted > 65535) {
      setError("Bitte eine Portnummer zwischen 1 und 65535 angeben.");
      return;
    }
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const bound = await startWebInterface(wanted);
        setRunning(true);
        setPort(bound);
        setInputPort(String(bound));
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

  const url = port !== null ? `http://localhost:${port}` : `http://localhost:${inputPort || FALLBACK_PORT}`;
  // The board is the page worth opening from here: the index only lists
  // landing pages, this is who is working and who is stuck.
  const boardUrl = `${url}/board`;

  return (
    <section className="sidebar-section webui-section">
      <div className="section-head">
        <h2 className="section-title">Web-Interface</h2>
        <span
          className={`webui-state${running === true ? " webui-state-on" : ""}`}
          title={
            running === null ? "Status wird geprüft" : running ? "Läuft" : "Gestoppt"
          }
        >
          {running === null ? "unbekannt" : running ? "läuft" : "aus"}
        </span>
      </div>

      <form className="webui-form" onSubmit={handleStart}>
        <input
          className="field webui-port"
          inputMode="numeric"
          aria-label="Port"
          placeholder={FALLBACK_PORT}
          value={inputPort}
          disabled={loading || running === true}
          onChange={(event) => setInputPort(event.target.value)}
        />
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
            type="submit"
            className="button-primary webui-start"
            disabled={loading}
          >
            {loading ? "Starte…" : "Starten"}
          </button>
        )}
      </form>

      {running && port !== null ? (
        <>
          <div className="webui-status">
            <span className="webui-url-label">URL:</span>
            <button
              type="button"
              className="webui-url"
              title={`${url} im Browser öffnen`}
              onClick={() => void openExternalSafely(url, setError)}
            >
              {url}
            </button>
          </div>
          <div className="webui-status">
            <span className="webui-url-label">Board:</span>
            <button
              type="button"
              className="webui-url"
              title={`${boardUrl} im Browser öffnen — read-only, auch vom Handy`}
              onClick={() => void openExternalSafely(boardUrl, setError)}
            >
              /board
            </button>
          </div>
        </>
      ) : (
        <div className="sidebar-note webui-hint">
          Shows the board and learnings in a browser on port{" "}
          {inputPort || FALLBACK_PORT}. For phone access on the same network:
          stop the interface, set <code>web_interface.bind</code> to{" "}
          <code>0.0.0.0</code> and <code>web_interface.token</code> to a secret
          of your choice — both are rows in the <code>settings</code> table of{" "}
          <code>projecta.db</code> in the app data directory (
          <code>%APPDATA%\com.projecta.app</code> on Windows), editable with any
          SQLite client — then start it again and open{" "}
          <code>http://DESKTOP-IP:PORT/board?token=SECRET</code> on the phone.
          The token travels in the URL: a hurdle for the local network, not
          real authentication.
        </div>
      )}

      {error ? <div className="sidebar-note sidebar-error">{error}</div> : null}
    </section>
  );
}
