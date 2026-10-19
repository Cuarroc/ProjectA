import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Button } from "../design/controls/Button";
import "../design/tokens.css";
import "./EmergencyStop.css";
import "../design/controls/controls.css";
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
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  const dialog = useRef<HTMLDivElement | null>(null);
  const justEngaged = useRef(false);
  const labelId = useId();
  const hintId = useId();
  const closeConfirm = useCallback(() => {
    const focusWasInside = dialog.current?.contains(document.activeElement) ?? false;
    setConfirming(false);
    if (focusWasInside) trigger.current?.focus();
  }, []);
  useEffect(() => {
    if (!active || !justEngaged.current) return;
    justEngaged.current = false;
    root.current?.querySelector("button")?.focus();
  }, [active]);

  const refresh = useCallback(() => {
    const mine = ++request.current;
    void getEmergencyStop()
      .then((value) => {
        if (request.current !== mine) return;
        setActive(value === true);
        if (value) setConfirming(false);
        if (!value) setConfirmed(false);
      })
      .catch(() => {
        if (request.current === mine) { setActive(true); setConfirming(false); }
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

  const hint = active
    ? confirmed
      ? "Not-Aus ist aktiv: keine neuen Aufgaben, alle Agenten sind beendet."
      : "Not-Aus ist aktiv: neue Aufgaben sind gesperrt; der Stillstand ist nicht bestätigt."
    : "Beendet binnen 10 Sekunden alle laufenden Agenten und stoppt neue Aufgaben.";

  return (
    <div data-testid="emergency-stop" className="g-estop" ref={root}>
      {active ? (
        <Button size="lg" disabled={busy} onClick={() => change(false)}>Not-Aus aufheben</Button>
      ) : (
        <Button
          size="lg"
          variant="danger"
          disabled={busy || active === null}
          aria-haspopup="dialog"
          aria-expanded={confirming}
          aria-describedby={hintId}
          onClick={(event) => { trigger.current = event.currentTarget; setConfirming(true); }}
        >
          Not-Aus auslösen
        </Button>
      )}
      <p id={hintId} role="status" title={hint} className="g-estop-hint">
        {hint}
      </p>
      {confirming && !active ? (
        <div
          className="g-estop-confirm"
          role="dialog"
          aria-labelledby={labelId}
          ref={dialog}
          onKeyDown={(event) => { if (event.key === "Escape") closeConfirm(); }}
        >
          <strong id={labelId}>Not-Aus bestätigen</strong>
          <p>Alle laufenden Agenten werden binnen 10 Sekunden beendet; neue Aufgaben werden gesperrt.</p>
          <div className="g-estop-actions">
            <Button size="sm" autoFocus onClick={closeConfirm}>Abbrechen</Button>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => { justEngaged.current = true; setConfirming(false); void change(true); }}>
              Ja, alles anhalten
            </Button>
          </div>
        </div>
      ) : null}
      {error ? <span role="alert" className="g-estop-error">{error}</span> : null}
    </div>
  );
}
