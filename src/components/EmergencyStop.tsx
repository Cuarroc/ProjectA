import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "../design/controls/Button";
import "../design/tokens.css";
import "../design/controls/controls.css";
import { describeError, getEmergencyStop, setEmergencyStop } from "../lib/ipc";
import { useRefreshOnResume } from "../lib/useRefreshOnResume";

const POLL_INTERVAL_MS = 5000;

/**
 * Not-Aus: stops every running agent (within 10 s) and blocks new dispatches
 * until it is lifted. An unreadable state is shown as "stopped", never as free.
 * The appearance prop remains accepted for existing callers; all controls use the design system.
 */
export default function EmergencyStop(props: { appearance?: "classic" | "glass" }) {
  void props;
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

  const hint = active
    ? confirmed
      ? "Not-Aus ist aktiv: keine neuen Aufgaben, alle Agenten sind beendet."
      : "Not-Aus ist aktiv: neue Aufgaben sind gesperrt; der Stillstand ist nicht bestätigt."
    : "Beendet binnen 10 Sekunden alle laufenden Agenten und stoppt neue Aufgaben.";

  return (
    <div data-testid="emergency-stop" style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
      {active ? (
        <Button size="lg" disabled={busy} onClick={() => change(false)}>Not-Aus aufheben</Button>
      ) : (
        <Button
          size="lg"
          variant="danger"
          disabled={busy || active === null}
          onClick={() => change(true)}
        >
          Not-Aus auslösen
        </Button>
      )}
      <p role="status" title={hint} style={{
        margin: 0, minWidth: 0, maxWidth: "28ch", overflow: "hidden", textOverflow: "ellipsis",
        whiteSpace: "nowrap", color: "var(--g-muted)", font: "400 12px/1.4 var(--g-font-sans)",
      }}>
        {hint}
      </p>
      {error ? <span role="alert" style={{ color: "var(--g-bad)", overflowWrap: "anywhere" }}>{error}</span> : null}
    </div>
  );
}
