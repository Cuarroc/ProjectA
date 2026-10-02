import { useEffect, useState } from "react";

import { describeError, getEmergencyStop, setEmergencyStop } from "../lib/ipc";

/**
 * Not-Aus: stops every running agent (within 10 s) and blocks new dispatches
 * until it is lifted. An unreadable state is shown as "stopped", never as free.
 */
export default function EmergencyStop() {
  const [active, setActive] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getEmergencyStop()
      .then((value) => alive && setActive(value === true))
      .catch(() => alive && setActive(true));
    return () => {
      alive = false;
    };
  }, []);

  async function change(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      await setEmergencyStop(next);
      setActive(next);
    } catch (e) {
      setError(describeError(e));
      // The barrier is written before the processes are ended: after a
      // failure raising it, it is up even though the end is unconfirmed.
      if (next) setActive(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-field" data-testid="emergency-stop">
      <span className="settings-label">Not-Aus</span>
      <div className="settings-port-row">
        {active ? (
          <button type="button" disabled={busy} onClick={() => change(false)}>
            Not-Aus aufheben
          </button>
        ) : (
          <button type="button" disabled={busy || active === null} onClick={() => change(true)}>
            Not-Aus auslösen
          </button>
        )}
      </div>
      <p className="settings-hint" role="status">
        {active
          ? "Not-Aus ist aktiv: keine neuen Aufgaben, alle Agenten sind beendet."
          : "Beendet binnen 10 Sekunden alle laufenden Agenten und stoppt neue Aufgaben."}
      </p>
      {error ? <span className="settings-error">{error}</span> : null}
    </div>
  );
}
