import {
  FREE_TIER_POLL_MS,
  formatProviderResetsAt,
  freeTierRemainingText,
  useFreeTierSummary,
} from "../lib/providers";
import type { FreeTierPool } from "../types";

interface FreeTierPanelProps {
  /** Heading; both hosts want a different one. */
  title?: string;
}

/**
 * OmniRoute's free pools: what is left in each, and which of them ProjectA's
 * curated `projecta-free` combo is willing to route through.
 *
 * The whole point of this panel is what it does when it has nothing: the
 * `/api/free-tier/summary` route is login-gated, so without a stored OmniRoute
 * token the core answers `available: false` with a reason, and that sentence
 * goes on screen unchanged. No zeroes, no dashes standing in for numbers
 * nobody reported — "Login fehlt" is the honest reading, and it is what the
 * user needs to act on.
 */
export default function FreeTierPanel({ title = "Free-Tier-Pools" }: FreeTierPanelProps) {
  const { summary, loading, error, refresh } = useFreeTierSummary(FREE_TIER_POLL_MS);

  return (
    <section className="free-tier">
      <header className="free-tier-head">
        <h2 className="section-title">{title}</h2>
        <button
          type="button"
          className="button-subtle free-tier-refresh"
          onClick={refresh}
          disabled={loading}
          title="Erneut prüfen"
          aria-label="Erneut prüfen"
        >
          ↻
        </button>
      </header>

      {loading && summary === null ? (
        <p className="free-tier-note">Lade Free-Tier-Kontingente…</p>
      ) : null}

      {error ? <p className="free-tier-note free-tier-error">{error}</p> : null}

      {summary !== null && !summary.available ? (
        <p className="free-tier-note free-tier-unavailable">
          {summary.reason ?? "Keine Free-Tier-Daten."}
        </p>
      ) : null}

      {summary !== null && summary.available && summary.pools.length === 0 ? (
        <p className="free-tier-note">OmniRoute meldet keine freien Pools.</p>
      ) : null}

      {summary !== null && summary.pools.length > 0 ? (
        <ul className="free-tier-list">
          {summary.pools.map((pool) => (
            <FreeTierRow key={pool.provider} pool={pool} />
          ))}
        </ul>
      ) : null}

      {summary !== null && summary.whitelist.length > 0 ? (
        <p className="free-tier-whitelist" title={summary.whitelist.join(", ")}>
          Whitelist (Combo <code>projecta-free</code>): {summary.whitelist.join(", ")}
        </p>
      ) : null}
    </section>
  );
}

function FreeTierRow({ pool }: { pool: FreeTierPool }) {
  const remaining = freeTierRemainingText(pool);
  const resets = formatProviderResetsAt(pool.resetsAt);

  return (
    <li className={`free-tier-row${pool.whitelisted ? "" : " free-tier-row-uncurated"}`}>
      <span className="free-tier-name" title={pool.provider}>
        {pool.label}
      </span>
      {pool.whitelisted ? (
        <span className="badge badge-free-tier-whitelist">Whitelist</span>
      ) : (
        <span className="badge badge-free-tier-uncurated" title="nicht in der kuratierten Combo">
          ungeprüft
        </span>
      )}
      {pool.tosStatus !== null ? (
        <span className="free-tier-tos" title="ToS-Hinweis von OmniRoute">
          ToS: {pool.tosStatus}
        </span>
      ) : null}
      {pool.remainingPercent !== null ? (
        <span className="free-tier-bar">
          <span className="free-tier-track">
            <span
              className={`free-tier-fill${pool.remainingPercent <= 10 ? " free-tier-fill-low" : ""}`}
              style={{ width: `${pool.remainingPercent}%` }}
            />
          </span>
          <span className="free-tier-percent">{pool.remainingPercent} %</span>
        </span>
      ) : null}
      <span className="free-tier-remaining">
        {remaining ?? <span className="free-tier-unknown">keine Angabe</span>}
      </span>
      {resets !== null ? <span className="free-tier-reset">{resets}</span> : null}
    </li>
  );
}
