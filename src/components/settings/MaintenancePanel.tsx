import { useEffect, useState } from "react";

import {
  describeError,
  enterMaintenance,
  getMaintenance,
  leaveMaintenance,
} from "../../lib/ipc";

/** Wartungsmodus controls for the backup drill. Rust owns the displayed state. */
export default function MaintenancePanel() {
  const [active, setActive] = useState<boolean | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getMaintenance()
      .then((value) => {
        if (!cancelled) setActive(value);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(describeError(cause));
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      <div className="settings-port-row">
        {active === true ? (
          <button
            type="button"
            className="button-ghost"
            disabled={busy}
            onClick={() => void change(false)}
          >
            Wartungsmodus beenden
          </button>
        ) : asking ? (
          <>
            <button
              type="button"
              className="button-danger"
              disabled={busy}
              onClick={() => void change(true)}
            >
              Ja, Wartungsmodus starten
            </button>
            <button
              type="button"
              className="button-ghost"
              disabled={busy}
              onClick={() => setAsking(false)}
            >
              Abbrechen
            </button>
          </>
        ) : (
          <button
            type="button"
            className="button-ghost"
            disabled={busy || active === null}
            onClick={() => setAsking(true)}
          >
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
