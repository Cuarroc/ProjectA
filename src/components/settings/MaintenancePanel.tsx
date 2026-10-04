import { useState } from "react";

import { describeError, enterMaintenance, leaveMaintenance } from "../../lib/ipc";

/**
 * Wartungsmodus for the backup drill. The backend has no getter, so the badge
 * follows the last successful command of this window, never a failed one.
 */
export default function MaintenancePanel() {
  const [active, setActive] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await (next ? enterMaintenance() : leaveMaintenance());
      setActive(next);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setAsking(false);
      setBusy(false);
    }
  };

  return (
    <div className="settings-field">
      <span className="field-label">
        Wartungsmodus
        {active ? <span className="settings-hint" role="status"> Aktiv</span> : null}
      </span>
      <p className="settings-hint">
        Hält neue Arbeit an und sperrt Schreibzugriffe, damit ein Backup sicher ist.
      </p>
      <div>
        {active ? (
          <button type="button" disabled={busy} onClick={() => void change(false)}>
            Wartungsmodus beenden
          </button>
        ) : asking ? (
          <>
            <button type="button" disabled={busy} onClick={() => void change(true)}>
              Ja, Wartungsmodus starten
            </button>
            <button type="button" disabled={busy} onClick={() => setAsking(false)}>
              Abbrechen
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setAsking(true)}>
            Wartungsmodus starten
          </button>
        )}
      </div>
      {asking ? (
        <p className="settings-hint">
          Läuft noch ein Worker, wird der Start abgelehnt. Wirklich starten?
        </p>
      ) : null}
      {error ? <span className="settings-error" role="alert">{error}</span> : null}
    </div>
  );
}
