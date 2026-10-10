import { useCallback, useEffect, useRef, useState } from "react";

import { describeError, getEmergencyStop, setEmergencyStop } from "../lib/ipc";
import { useRefreshOnResume } from "../lib/useRefreshOnResume";

const POLL_INTERVAL_MS = 5000;

/**
 * Not-Aus: stops every running agent (within 10 s) and blocks new dispatches
 * until it is lifted. An unreadable state is shown as "stopped", never as free.
 */
export default function EmergencyStop() {
  const [active, setActive] = useState<boolean | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const refresh = useCallback(() => {
    const mine = ++request.current;
    void getEmergencyStop()
      .then((value) => {
        if (request.current !== mine) return;
        setActive(value === true);
        if (!value) setConfirmed(false);
      })
      .catch(() => {
        if (request.current === mine) setActive(true);
      });
  }, []);

  useRefreshOnResume(refresh);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_INTERVAL_MS);
    return () => {
      request.current += 1;
      window.clearInterval(timer);
    };
  }, [refresh]);

  async function change(next: boolean) {
    request.current += 1;
    setBusy(true);
    setError(null);
    try {
      await setEmergencyStop(next);
      request.current += 1;
      setActive(next);
      setConfirmed(next);
    } catch (e) {
      request.current += 1;
      setError(describeError(e));
      setConfirmed(false);
      // The barrier is written before the processes are ended: after a
      // failure raising it, it is up even though the end is unconfirmed.
      if (next) setActive(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-field" data-testid="emergency-stop">
      <span className="field-label">Not-Aus</span>
      <div className="settings-port-row">
        {active ? (
          <button
            type="button"
            className="button-ghost"
            disabled={busy}
            onClick={() => change(false)}
          >
            Not-Aus aufheben
          </button>
        ) : (
          <button
            type="button"
            className="button-danger"
            disabled={busy || active === null}
            onClick={() => change(true)}
          >
            Not-Aus auslösen
          </button>
        )}
      </div>
      <p className="settings-hint" role="status">
        {active
          ? confirmed
            ? "Not-Aus ist aktiv: keine neuen Aufgaben, alle Agenten sind beendet."
            : "Not-Aus ist aktiv: neue Aufgaben sind gesperrt; der Stillstand ist nicht bestätigt."
          : "Beendet binnen 10 Sekunden alle laufenden Agenten und stoppt neue Aufgaben."}
      </p>
      {error ? <span className="settings-error" role="alert">{error}</span> : null}
    </div>
  );
}
