import { useCallback, useEffect, useState } from "react";

import { Button } from "../../design/controls/Button";
import { describeError, getEmergencyStop, setEmergencyStop } from "../../lib/ipc";
import "./header.css";

const POLL_MS = 5000;

/** Band under the header while Not-Aus is active. An unreadable state counts as active, like in EmergencyStop. */
export function StopBand() {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    getEmergencyStop().then((v) => setActive(v === true), () => setActive(true));
  }, []);
  useEffect(() => {
    refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") refresh(); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (!active) return null;
  const resume = () => {
    setError(null);
    setEmergencyStop(false).then(() => setActive(false), (e) => setError(describeError(e)));
  };
  return (
    <div className="g-hdr-stop" role="status">
      <p>Not-Aus ist aktiv: neue Aufgaben sind gesperrt.</p>
      {error ? <span role="alert">{error}</span> : null}
      <Button size="sm" onClick={resume}>Fortsetzen</Button>
    </div>
  );
}
