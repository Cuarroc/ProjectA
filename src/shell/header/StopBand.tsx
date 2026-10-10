import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "../../design/controls/Button";
import { describeError, getEmergencyStop, setEmergencyStop } from "../../lib/ipc";
import "./header.css";

const POLL_MS = 5000;

/** Band under the header while Not-Aus is active. An unreadable state counts as active, like in EmergencyStop. */
export function StopBand() {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bumped when a resume starts and when it ends: a poll that spans either is stale and must not flip the band back.
  const resumeGen = useRef(0);
  const resuming = useRef(false);

  const refresh = useCallback(() => {
    const gen = resumeGen.current;
    const apply = (next: boolean) => { if (!resuming.current && gen === resumeGen.current) setActive(next); };
    getEmergencyStop().then((v) => apply(v === true), () => apply(true));
  }, []);
  useEffect(() => {
    refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") refresh(); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (!active) return null;
  const resume = () => {
    setError(null);
    resuming.current = true;
    resumeGen.current += 1;
    const settled = () => { resuming.current = false; resumeGen.current += 1; };
    setEmergencyStop(false).then(() => { settled(); setActive(false); }, (e) => { settled(); setError(describeError(e)); });
  };
  return (
    <div className="g-hdr-stop" role="status">
      <p>Not-Aus ist aktiv: neue Aufgaben sind gesperrt.</p>
      {error ? <span role="alert">{error}</span> : null}
      <Button size="sm" onClick={resume}>Fortsetzen</Button>
    </div>
  );
}
