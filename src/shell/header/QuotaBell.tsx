import { HonestState } from "../../design/data/HonestState";
import "./header.css";

/** Quota bar: no backend yet, so it says so instead of drawing meters (HonestState never shows a number). */
export function QuotaBar() {
  return (
    <a className="g-hdr-quota" href="#/steuerung" aria-label="Kontingente: noch nicht verbunden" title="Kontingente: noch nicht verbunden">
      <HonestState kind="offline" title="Kontingente: noch nicht verbunden" />
    </a>
  );
}

/** Bell: opens the notification settings. No badge until a notification source exists. */
export function Bell() {
  return (
    <a className="g-hdr-bell" href="#/einstellungen/benachrichtigungen" aria-label="Benachrichtigungen: noch nicht verbunden">
      <svg className="g-shell-ic" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 13.5V9a5 5 0 0 1 10 0v4.5l1.5 2h-13ZM8.5 17.5h3" /></svg>
    </a>
  );
}
