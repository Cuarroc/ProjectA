import { useEffect, useId, useState } from "react";

import "../../design/tokens.css";
import "../../design/controls/controls.css";
import "../../design/layout/layout.css";
import { Button } from "../../design/controls/Button";
import { Sheet } from "../../design/layout/Sheet";
import {
  describeError,
  enterMaintenance,
  getMaintenance,
  leaveMaintenance,
} from "../../lib/ipc";
import { T } from "./maintenance/texts";

/** Wartungsmodus controls for the backup drill. Rust owns the displayed state. */
export default function MaintenancePanel() {
  const [active, setActive] = useState<boolean | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = useId();
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
        {T.label}
        {active ? <span className="settings-hint" role="status"> {T.active}</span> : null}
      </span>
      <p className="settings-hint">{T.hint}</p>
      <div className="settings-port-row">
        {active === true ? (
          <Button variant="ghost" disabled={busy} onClick={() => void change(false)}>{T.leave}</Button>
        ) : (
          <Button variant="ghost" disabled={busy || active === null} onClick={() => setAsking(true)}>{T.start}</Button>
        )}
      </div>
      <Sheet
        open={asking}
        onClose={() => { if (!busy) setAsking(false); }}
        role="alertdialog"
        size="sm"
        dismissOnScrim={false}
        aria-labelledby={`${id}-t`}
        aria-describedby={`${id}-d`}
      >
        <div className="g-confirm">
          <h2 id={`${id}-t`}>{T.title}</h2>
          <p id={`${id}-d`}>{T.body}</p>
          <div className="g-confirm__actions">
            <Button disabled={busy} onClick={() => setAsking(false)}>{T.cancel}</Button>
            <Button variant="danger" disabled={busy} onClick={() => void change(true)}>{T.confirm}</Button>
          </div>
        </div>
      </Sheet>
      {error ? <span className="settings-error" role="alert">{error}</span> : null}
    </div>
  );
}
