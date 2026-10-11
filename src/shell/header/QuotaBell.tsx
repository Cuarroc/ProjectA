import { Meter } from "../../design/inputs/Meter";
import "../../design/inputs/inputs.css";
import { PROVIDER_POLL_MS, useProviderOverview } from "../../lib/providers";
import { QUOTA_POLL_MS, useQuotaState } from "../../lib/quota";
import { quotaSummary } from "./texts";
import "./quotaBar.css";
import "./header.css";

/** Read-only observations from the existing hooks and their polling cadence. */
export function QuotaBar() {
  const quota = useQuotaState(QUOTA_POLL_MS);
  const overview = useProviderOverview(PROVIDER_POLL_MS);
  const summary = quotaSummary(quota, overview);
  return (
    <a className="g-hdr-quota g-quota-observed" data-blocked={summary.blocked || undefined} href="#/steuerung" aria-label={summary.text} title={summary.text}>
      <span>{summary.text}</span>
      {summary.percent !== null && <Meter value={summary.percent} aria-label={summary.text} />}
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
