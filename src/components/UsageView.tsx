import { useEffect, useMemo, useRef, useState } from "react";

import FreeTierPanel from "./FreeTierPanel";
import { describeError, getBudgets, getOmniRouteUsage, getQuotaState } from "../lib/ipc";
import { isRoutedProfile } from "../lib/providers";
import { blockedLabel, formatRelativeUntil, isBlocked } from "../lib/quota";
import type {
  AgentProfile,
  BoardCard,
  Budget,
  QuotaState,
  UsageReport,
  UsageTotals,
  Worker,
} from "../types";

interface UsageViewProps {
  profiles: AgentProfile[];
  /** Live board cards carry the per-worker context usage. */
  cards: BoardCard[];
  /** Running workers of the active project, including those without a card. */
  workers: Worker[];
}

interface WorkerUsage {
  worker: Worker;
  used: number;
  total: number;
}

const POLL_INTERVAL_MS = 10_000;

/**
 * How the core opens the reason of a quota block it wrote itself, mirroring
 * `budget::REASON_PREFIX`. A block that starts with it is the user's own
 * ceiling; anything else came from the provider.
 */
const BUDGET_REASON_PREFIX = "Budget:";

/** A ceiling as a cell, or an em dash where there is none. */
function budgetCell(percent: number | null): string {
  return percent === null ? "—" : `${percent} %`;
}

/** How many ledger rows the section lists. The rest stay in the database. */
const USAGE_ROWS = 12;

/** One read that reports its failure instead of throwing it away. */
type ReadResult<T> = { ok: true; value: T } | { ok: false; error: string };

function settle<T>(read: Promise<T>): Promise<ReadResult<T>> {
  return read.then(
    (value) => ({ ok: true as const, value }),
    (cause: unknown) => ({ ok: false as const, error: describeError(cause) }),
  );
}

/**
 * One totals line. The dollars are deliberately not printed as `0,00 $` when
 * nothing was priced: OmniRoute's request log carries tokens but no price, and
 * an unpriced ledger is not a free one.
 */
function totalsLabel(totals: UsageTotals): string {
  const tokens = `${totals.tokensIn.toLocaleString()} ein / ${totals.tokensOut.toLocaleString()} aus`;
  const cost =
    totals.priced === 0
      ? "keine Preisangabe"
      : `${totals.costUsd.toFixed(4)} $ über ${totals.priced} Zeile(n)`;
  return `${totals.requests.toLocaleString()} Anfragen · ${tokens} Tokens · ${cost}`;
}

/** `HH:MM` in local time - the ledger's own day boundary is UTC, the list is not. */
function clockLabel(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * A one-stop view for capacity: profile quota, OmniRoute reachability and its
 * free pools, and the context window fill of every running worker. Everything
 * here is already available in the app; Usage just gathers it in one place.
 */
export default function UsageView({ profiles, cards, workers }: UsageViewProps) {
  const [quotas, setQuotas] = useState<QuotaState[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  // `null` is "not read (successfully)": an unreadable ledger must not be
  // rendered as "kein Token" plus zero totals — those are claims, not absence.
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    const refresh = async () => {
      try {
        // Both on the same beat: a ceiling the user just changed and the block
        // it caused belong on screen together, and neither read is expensive.
        // Each read settles on its own: a failing one must not cost the rows
        // the others brought in — and its failure is kept as a failure, not
        // smoothed into empty data.
        const [quotaRead, nextBudgets, usageRead] = await Promise.all([
          settle(getQuotaState()),
          getBudgets().catch(() => [] as Budget[]),
          settle(getOmniRouteUsage(USAGE_ROWS)),
        ]);
        if (!aliveRef.current) return;
        if (quotaRead.ok) {
          setQuotas(quotaRead.value);
          setQuotaError(null);
        } else {
          setQuotaError(quotaRead.error);
        }
        setBudgets(nextBudgets);
        if (usageRead.ok) {
          setUsage(usageRead.value);
          setUsageError(null);
        } else {
          setUsage(null);
          setUsageError(usageRead.error);
        }
      } finally {
        if (aliveRef.current) setLoading(false);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      aliveRef.current = false;
      window.clearInterval(timer);
    };
  }, []);

  const quotaByProfile = useMemo(
    () => new Map(quotas.map((entry) => [entry.profileId, entry])),
    [quotas],
  );

  const budgetByProfile = useMemo(
    () => new Map(budgets.map((entry) => [entry.profileId, entry])),
    [budgets],
  );

  const omniRouteOnline = useMemo(
    () => quotas.some((entry) => entry.omniRouteOnline),
    [quotas],
  );

  // Three honest states: asked-but-unanswered, unreadable, and answered.
  // Claiming "offline" for the first two was the original false claim.
  const omniChip =
    quotaError !== null
      ? {
          label: "OmniRoute unbekannt",
          title: `OmniRoute-Status nicht lesbar: ${quotaError}`,
          online: false,
        }
      : loading
        ? {
            label: "OmniRoute wird geprüft",
            title: "OmniRoute-Status wird geprüft",
            online: false,
          }
        : {
            label: `OmniRoute ${omniRouteOnline ? "online" : "offline"}`,
            title: `OmniRoute ${omniRouteOnline ? "online" : "offline"}`,
            online: omniRouteOnline,
          };

  const workerUsages = useMemo(() => {
    const map = new Map<string, WorkerUsage>();
    for (const card of cards) {
      const usage = card.contextUsage;
      if (!usage) continue;
      map.set(card.worker.id, {
        worker: card.worker,
        used: usage.used,
        total: usage.total,
      });
    }
    const result: WorkerUsage[] = [];
    for (const worker of workers) {
      if (worker.status !== "running") continue;
      const known = map.get(worker.id);
      if (known) {
        result.push(known);
      } else {
        result.push({ worker, used: 0, total: 0 });
      }
    }
    return result.sort((a, b) => a.worker.task.localeCompare(b.worker.task));
  }, [cards, workers]);

  return (
    <div className="usage-view">
      <section className="usage-section">
        <header className="usage-head">
          <h2 className="section-title">Agent-Profile</h2>
          <span
            className={`usage-omni ${omniChip.online ? "usage-omni-online" : ""}`}
            title={omniChip.title}
          >
            <span className={`omni-dot${omniChip.online ? " omni-dot-online" : ""}`} aria-hidden="true" />
            {omniChip.label}
          </span>
        </header>
        {profiles.length === 0 ? (
          <p className="usage-empty">{loading ? "Lade Kontingente…" : "Keine Agent-Profile bekannt."}</p>
        ) : (
          <ul className="usage-list">
            {profiles.map((profile) => {
              const quota = quotaByProfile.get(profile.id);
              const blocked = isBlocked(quota);
              const budget = budgetByProfile.get(profile.id);
              const byBudget =
                blocked === true && (quota?.reason ?? "").startsWith(BUDGET_REASON_PREFIX);
              const routed = isRoutedProfile(profile);
              return (
                <li key={profile.id} className={`usage-row${blocked ? " usage-row-blocked" : ""}`}>
                  <span className="usage-name" title={profile.command + " " + profile.args.join(" ")}>
                    {profile.name}
                  </span>
                  <span className={`usage-state usage-state-${quota?.state ?? "unknown"}`}>
                    {stateLabel(quota?.state ?? "unknown")}
                  </span>
                  {routed || profile.fallback !== null || byBudget ? (
                    <div className="usage-tags">
                      {routed ? (
                        <span
                          className="badge badge-routed"
                          title="Dieses Profil spawnt mit einer OmniRoute-Basis-URL — nicht über den Abo-Pfad des Anbieters."
                        >
                          via OmniRoute
                        </span>
                      ) : null}
                      {profile.fallback !== null ? (
                        <span
                          className="usage-badge usage-badge-fallback"
                          title="Bei Quota- oder Budget-Block übernimmt dieses Profil die Aufgabe."
                        >
                          Fallback: {profile.fallback}
                        </span>
                      ) : null}
                      {byBudget ? (
                        <span className="usage-badge">pausiert durch Budget</span>
                      ) : null}
                    </div>
                  ) : null}
                  <span className="usage-budget" title="Budget-Schwellen: 5-Stunden- und 7-Tage-Fenster">
                    {budget === undefined
                      ? "kein Budget"
                      : `Budget 5h ${budgetCell(budget.fiveHourPct)} · 7d ${budgetCell(budget.sevenDayPct)}`}
                  </span>
                  {quota?.state === "blocked" ? (
                    <span className="usage-detail">
                      {blockedLabel(quota)}
                      {quota.blockedUntil !== null ? (
                        <span className="usage-until"> ({formatRelativeUntil(quota.blockedUntil)})</span>
                      ) : null}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="usage-section">
        <FreeTierPanel title="OmniRoute Free-Tier" />
      </section>

      <section className="usage-section">
        <header className="usage-head">
          <h2 className="section-title">OmniRoute-Kosten</h2>
          <span
            className={`usage-omni ${usage?.authorized === true ? "usage-omni-online" : ""}`}
            title={
              usage === null
                ? "OmniRoute-Nutzung nicht lesbar"
                : usage.authorized
                  ? "Management-API offen — das Ledger füllt sich"
                  : "Kein Management-Token hinterlegt, oder OmniRoute hat es abgelehnt"
            }
          >
            <span
              className={`omni-dot${usage?.authorized === true ? " omni-dot-online" : ""}`}
              aria-hidden="true"
            />
            {usage === null
              ? "Management-API ungeprüft"
              : `Management-API ${usage.authorized ? "offen" : "geschlossen"}`}
          </span>
        </header>
        {usage === null ? (
          <p className="usage-empty">
            {loading
              ? "Lade OmniRoute-Nutzung…"
              : `OmniRoute-Nutzung nicht lesbar${usageError !== null ? `: ${usageError}` : "."}`}
          </p>
        ) : (
          <>
            {!usage.authorized ? (
              <p className="usage-empty">
                Kein Management-Token für OmniRoute hinterlegt (oder es wurde abgelehnt). Das Ledger
                bleibt stehen; Provider-Dialog → „OmniRoute (Management)" trägt eines ein.
              </p>
            ) : null}
            <ul className="usage-list">
              <li className="usage-row">
                <span className="usage-name">Heute</span>
                <span className="usage-detail">{totalsLabel(usage.today)}</span>
              </li>
              <li className="usage-row">
                <span className="usage-name">Gesamt</span>
                <span className="usage-detail">{totalsLabel(usage.total)}</span>
              </li>
              <li className="usage-row">
                <span className="usage-name" title="OmniRoutes eigene Lebenszeit-Summe">
                  Von OmniRoute gemeldet
                </span>
                <span className="usage-detail">
                  {usage.reportedCostUsd === null
                    ? "keine Angabe"
                    : `${usage.reportedCostUsd.toFixed(4)} $ seit Beginn`}
                </span>
              </li>
            </ul>
            {usage.events.length === 0 ? (
              <p className="usage-empty">Noch keine OmniRoute-Anfragen protokolliert.</p>
            ) : (
              <ul className="usage-list">
                {usage.events.map((event) => (
                  <li key={event.id} className="usage-row">
                    <span className="usage-name" title={event.rawJson}>
                      {event.model}
                    </span>
                    <span className="usage-state usage-state-unknown">{event.provider}</span>
                    <span className="usage-detail">
                      {event.tokensIn.toLocaleString()} ein / {event.tokensOut.toLocaleString()} aus
                    </span>
                    <span className="usage-budget">
                      {/* Never a 0,00 $: OmniRoutes Zeilen-Log kennt keinen Preis. */}
                      {event.costUsd === null ? "— $" : `${event.costUsd.toFixed(4)} $`}
                    </span>
                    <span className="usage-budget" title="Zuordnung nur, wenn ein Profil dieses Modell festlegt">
                      {event.profileId ?? "kein Profil zuordenbar"}
                    </span>
                    <span className="usage-until">{clockLabel(event.ts)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="usage-empty">
              Zuordnung bleibt auf Profil-Ebene: OmniRoutes Log führt weder Session noch Client, und der
              Header <code>X-OmniRoute-Session-Id</code> wird serverseitig vergeben, nicht vom CLI
              gesetzt. Eine Anfrage lässt sich deshalb keinem einzelnen Worker zuschreiben.
            </p>
          </>
        )}
      </section>

      <section className="usage-section">
        <header className="usage-head">
          <h2 className="section-title">Worker-Kontext</h2>
        </header>
        {workerUsages.length === 0 ? (
          <p className="usage-empty">Keine laufenden Worker — erst ein Worker starten, um seine Auslastung zu sehen.</p>
        ) : (
          <ul className="usage-list">
            {workerUsages.map(({ worker, used, total }) => {
              const known = total > 0;
              const percent = known ? Math.round((used / total) * 100) : null;
              return (
                <li key={worker.id} className="usage-row">
                  <span className="usage-name" title={worker.task}>
                    {worker.task || worker.branch}
                  </span>
                  {known ? (
                    <span className="usage-context">
                      <span className="usage-context-track">
                        <span
                          className={`usage-context-fill${
                            percent && percent >= 90
                              ? " usage-context-fill-critical"
                              : percent && percent >= 70
                                ? " usage-context-fill-high"
                                : ""
                          }`}
                          style={{ width: `${percent}%` }}
                        />
                      </span>
                      <span className="usage-context-label">
                        {used.toLocaleString()} / {total.toLocaleString()} ({percent}%)
                      </span>
                    </span>
                  ) : (
                    <span className="usage-detail">keine Angabe</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function stateLabel(state: QuotaState["state"]): string {
  switch (state) {
    case "ok":
      return "ok";
    case "blocked":
      return "blockiert";
    case "unknown":
      return "unbekannt";
  }
}
