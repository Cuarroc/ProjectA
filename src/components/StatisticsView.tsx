import { useEffect, useMemo, useRef, useState } from "react";

import { getProjectStats } from "../lib/ipc";
import type { ProjectStats, StatsLabelCount, StatsRange } from "../types";

interface StatisticsViewProps {
  /** The active project, or `null` when none is selected. */
  projectId: string | null;
}

/** The same beat as the Usage view: fresh enough to watch, cheap enough to poll. */
const POLL_INTERVAL_MS = 10_000;

const RANGES: ReadonlyArray<{ id: StatsRange; label: string; title: string }> = [
  { id: "today", label: "Heute", title: "Seit 00:00 UTC" },
  { id: "week", label: "7 Tage", title: "Die letzten sieben Tage" },
  { id: "month", label: "30 Tage", title: "Die letzten dreißig Tage" },
  { id: "all", label: "Gesamt", title: "Alles, was die Datenbank noch hat" },
];

/** German labels for the board columns the core counts in. */
const COLUMN_LABELS: Record<string, string> = {
  working: "arbeitet",
  needs_you: "braucht dich",
  in_review: "im Review",
  ready_to_merge: "merge-bereit",
  done: "fertig",
  archived: "archiviert",
};

/** German labels for the queue states. */
const QUEUE_LABELS: Record<string, string> = {
  queued: "wartend",
  sharpening: "wird geschärft",
  ready: "bereit",
  dispatching: "wird gestartet",
  dispatched: "gestartet",
  failed: "fehlgeschlagen",
};

/** The three terms of the completion estimate, spelled out for the tooltip. */
const COMPONENT_LABELS: Record<string, string> = {
  workers: "Worker nach Board-Spalte",
  queue: "Queue: dispatched von allen Einträgen",
  tests: "Test-Gates: grün von allen mit Verdikt",
};

function label(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
}

/** Seconds as the largest unit that still reads as a duration. */
function duration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`;
}

/** A unix second as a local date and time. */
function clockLabel(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** `2026-08-27` as `27.08.` - the timeline has no room for the year. */
function dayLabel(date: string): string {
  const [, month, day] = date.split("-");
  return month && day ? `${day}.${month}.` : date;
}

/** Rows with a count of zero are dropped: a tile lists what is there. */
function nonEmpty(rows: StatsLabelCount[]): StatsLabelCount[] {
  return rows.filter((row) => row.count > 0);
}

/**
 * Project figures in one place: board, queue, tokens, sessions, activity and a
 * derived completion estimate.
 *
 * The tab's rule is that a number it cannot measure is not printed as a zero.
 * Token usage says "nicht gemessen" until the OmniRoute ledger has rows for
 * the window, because an agent that talks to its vendor directly spends tokens
 * this app never sees; the completion figure is always labelled "geschätzt"
 * and carries its own arithmetic in a tooltip, because there is no machine
 * readable plan per project to measure against.
 */
export default function StatisticsView({ projectId }: StatisticsViewProps) {
  const [range, setRange] = useState<StatsRange>("week");
  const [stats, setStats] = useState<ProjectStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Guards against a slow response for a range or project the user already
  // left: every request gets a token, only the newest one may write. The
  // alive-flag this replaces could not tell "unmounted" from "superseded by
  // the next range" — a late answer wrote the old window's numbers under the
  // new window's label. Same pattern as useBoard.
  const tokenRef = useRef(0);

  useEffect(() => {
    if (projectId === null) {
      setStats(null);
      setLoading(false);
      return;
    }
    // A range change re-reads immediately rather than waiting out the poll:
    // the numbers on screen would otherwise belong to the previous window for
    // up to ten seconds, under the new window's label.
    setLoading(true);
    const refresh = async () => {
      const mine = ++tokenRef.current;
      try {
        const next = await getProjectStats(projectId, range);
        if (tokenRef.current !== mine) return;
        setStats(next);
        setError(null);
      } catch (err) {
        if (tokenRef.current !== mine) return;
        setError(String(err));
      } finally {
        if (tokenRef.current === mine) setLoading(false);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      // Anything still in flight belongs to the window (or the mount) that is
      // being left behind.
      tokenRef.current += 1;
      window.clearInterval(timer);
    };
  }, [projectId, range]);

  const busiestDay = useMemo(() => {
    if (stats === null) return 0;
    return stats.timeline.reduce(
      (top, day) => Math.max(top, day.messages + day.statusEvents),
      0,
    );
  }, [stats]);

  /** The estimate's arithmetic, as one tooltip. */
  const estimateTitle = useMemo(() => {
    if (stats === null) return "";
    const weights = stats.completion.columnWeights
      .map(([column, weight]) => `${label(COLUMN_LABELS, column)} ${weight}`)
      .join(" · ");
    const terms = stats.completion.components
      .map(
        (part) =>
          `${label(COMPONENT_LABELS, part.key)}: ${part.detail} = ${(part.score * 100).toFixed(0)} %, ` +
          `Anteil ${(part.weight * 100).toFixed(0)} %`,
      )
      .join("\n");
    return (
      "Geschätzt, nicht gemessen. Gewichtete Mischung aus den Teilen, " +
      "für die es Daten gibt:\n" +
      `${terms}\n\nSpalten-Gewichte: ${weights}\n` +
      "Archivierte Worker zählen als 1,0 — in ProjectA wird beim Merge archiviert."
    );
  }, [stats]);

  if (projectId === null) {
    return (
      <div className="stats-view">
        <p className="usage-empty">Kein Projekt gewählt — erst ein Projekt auswählen.</p>
      </div>
    );
  }

  if (stats === null) {
    return (
      <div className="stats-view">
        <p className="usage-empty">
          {error !== null ? `Statistik nicht lesbar: ${error}` : "Lade Statistik…"}
        </p>
      </div>
    );
  }

  const { overview, tokens, sessions, timeline, completion } = stats;

  return (
    <div className="stats-view">
      <header className="stats-head">
        <h2 className="section-title">Statistik — {stats.projectName}</h2>
        <div className="segmented" role="group" aria-label="Zeitraum">
          {RANGES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={range === entry.id}
              title={entry.title}
              className={`segment${range === entry.id ? " segment-active" : ""}`}
              onClick={() => setRange(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <span className="stats-stamp" title="Zeitpunkt dieser Messung">
          {loading ? "aktualisiert…" : `Stand ${clockLabel(stats.generatedAt)}`}
        </span>
      </header>

      {error !== null ? (
        <p className="usage-empty">
          Letzte Aktualisierung fehlgeschlagen ({error}) — die Zahlen unten sind älter.
        </p>
      ) : null}

      <div className="stats-body">
        <div className="stats-tiles">
          {/* -- Übersicht ---------------------------------------------------- */}
          <section className="stats-tile">
            <header className="usage-head">
              <h3 className="section-title">Übersicht</h3>
            </header>
            <ul className="usage-list">
              <li className="usage-row">
                <span className="usage-name">Worker</span>
                <span className="usage-detail">
                  {overview.workersActive} aktiv · {overview.workersArchived} archiviert ·{" "}
                  {overview.workersTotal} gesamt
                </span>
              </li>
              <li className="usage-row">
                <span className="usage-name">Board</span>
                <span className="usage-detail">
                  {nonEmpty(overview.byColumn).length === 0
                    ? "keine Karten auf dem Board"
                    : nonEmpty(overview.byColumn)
                        .map((row) => `${row.count} ${label(COLUMN_LABELS, row.key)}`)
                        .join(" · ")}
                </span>
              </li>
              <li className="usage-row">
                <span className="usage-name">Offene Entscheidungen</span>
                <span className="usage-detail">
                  {overview.needsAttention} Karte(n) warten auf dich
                </span>
              </li>
              <li className="usage-row">
                <span className="usage-name">Queue</span>
                <span className="usage-detail">
                  {overview.queueTotal === 0
                    ? "leer"
                    : nonEmpty(overview.queue)
                        .map((row) => `${row.count} ${label(QUEUE_LABELS, row.key)}`)
                        .join(" · ")}
                </span>
              </li>
              <li className="usage-row">
                <span className="usage-name">Learnings offen</span>
                <span className="usage-detail">{overview.learningsPending} zur Freigabe</span>
              </li>
              <li className="usage-row">
                <span className="usage-name" title="Nur diese Zeile zählt im gewählten Zeitraum">
                  Im Zeitraum
                </span>
                <span className="usage-detail">
                  {overview.messages} Nachricht(en) · {overview.statusEvents} Ereignis(se) ·{" "}
                  {overview.diffComments} Review-Kommentar(e) · {overview.workersCreated} neue
                  Worker
                </span>
              </li>
            </ul>
            <p className="usage-empty stats-note">
              Board, Queue und Learnings sind eine Momentaufnahme von jetzt; nur die letzte Zeile
              folgt dem gewählten Zeitraum.
            </p>
          </section>

          {/* -- Tokenverbrauch ----------------------------------------------- */}
          <section className="stats-tile">
            <header className="usage-head">
              <h3 className="section-title">Tokenverbrauch</h3>
            </header>
            {tokens === null ? (
              <p className="usage-empty">
                <strong>Nicht gemessen.</strong> Für diesen Zeitraum liegt im OmniRoute-Ledger keine
                Zeile. Gezählt wird nur, was durch OmniRoute läuft — ein Agent, der direkt mit
                seinem Anbieter spricht, verbraucht Tokens, die diese App nicht sehen kann. Hier
                stünde sonst eine 0, und die wäre falsch. Profile mit dem Abzeichen „via OmniRoute"
                (Usage-Tab) landen im Ledger.
              </p>
            ) : (
              <>
                <ul className="usage-list">
                  <li className="usage-row">
                    <span className="usage-name">Anfragen</span>
                    <span className="usage-detail">{tokens.requests.toLocaleString()}</span>
                  </li>
                  <li className="usage-row">
                    <span className="usage-name">Tokens</span>
                    <span className="usage-detail">
                      {tokens.tokensIn.toLocaleString()} ein / {tokens.tokensOut.toLocaleString()} aus
                    </span>
                  </li>
                  <li className="usage-row">
                    <span className="usage-name">Kosten</span>
                    <span className="usage-detail">
                      {/* Nie 0,00 $: OmniRoutes Zeilen-Log kennt keinen Preis. */}
                      {tokens.priced === 0
                        ? "keine Preisangabe im Log"
                        : `${tokens.costUsd.toFixed(4)} $ über ${tokens.priced} Zeile(n)`}
                    </span>
                  </li>
                </ul>
                <ul className="usage-list">
                  {tokens.byProfile.map((row) => (
                    <li key={row.profileId ?? "unattributed"} className="usage-row">
                      <span className="usage-name">
                        {row.profileId ?? "keinem Profil zuordenbar"}
                      </span>
                      <span className="usage-detail">
                        {row.requests.toLocaleString()} Anfragen ·{" "}
                        {row.tokensIn.toLocaleString()} ein / {row.tokensOut.toLocaleString()} aus
                      </span>
                      {row.usedByProject ? (
                        <span
                          className="usage-badge"
                          title="Ein Worker dieses Projekts lief unter diesem Profil"
                        >
                          von diesem Projekt genutzt
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <p className="usage-empty stats-note">
                  Flottenweit, nicht projektbezogen: OmniRoutes Log führt weder Session noch Client,
                  eine Anfrage lässt sich deshalb keinem einzelnen Worker zuschreiben. Das Abzeichen
                  markiert nur, dass dieses Projekt dasselbe Profil benutzt hat.
                </p>
              </>
            )}
          </section>

          {/* -- Sessions ------------------------------------------------------ */}
          <section className="stats-tile">
            <header className="usage-head">
              <h3 className="section-title">Sessions</h3>
            </header>
            {sessions.total === 0 ? (
              <p className="usage-empty">
                Keine Session in diesem Zeitraum. Sessions werden seit Phase 20 mitgeschrieben —
                was davor lief, steht in keiner Tabelle.
              </p>
            ) : (
              <>
                <ul className="usage-list">
                  <li className="usage-row">
                    <span className="usage-name">Anzahl</span>
                    <span className="usage-detail">
                      {sessions.total} gesamt · {sessions.ended} beendet · {sessions.open} offen
                    </span>
                  </li>
                  <li className="usage-row">
                    <span className="usage-name">Dauer</span>
                    <span className="usage-detail">
                      {sessions.ended === 0
                        ? "noch keine beendete Session"
                        : `${duration(sessions.totalSeconds)} gesamt · Median ${
                            sessions.medianSeconds === null
                              ? "—"
                              : duration(sessions.medianSeconds)
                          }`}
                    </span>
                  </li>
                  <li className="usage-row">
                    <span
                      className="usage-name"
                      title="Ein fehlender Exit-Code ist nicht dasselbe wie Code 0"
                    >
                      Abbrüche
                    </span>
                    <span className="usage-detail">
                      {sessions.failureRatio === null
                        ? "nichts beendet"
                        : `${sessions.failed} von ${sessions.ended} mit Exit ≠ 0 (${Math.round(
                            sessions.failureRatio * 100,
                          )} %)`}
                      {sessions.unknownExit > 0
                        ? ` · ${sessions.unknownExit} ohne Code`
                        : ""}
                    </span>
                  </li>
                </ul>
                <ul className="usage-list stats-sessions">
                  {sessions.recent.map((session) => (
                    <li key={session.sessionId} className="usage-row">
                      <span className="usage-name" title={session.task}>
                        {session.task === "" ? session.workerId : session.task}
                      </span>
                      <span className="usage-until">{clockLabel(session.startedAt)}</span>
                      <span className="usage-detail">
                        {session.duration === null ? "läuft" : duration(session.duration)}
                      </span>
                      <span
                        className={`usage-state usage-state-${
                          session.endedAt === null
                            ? "unknown"
                            : session.exitCode === 0
                              ? "ok"
                              : session.exitCode === null
                                ? "unknown"
                                : "blocked"
                        }`}
                      >
                        {session.endedAt === null
                          ? "offen"
                          : session.exitCode === null
                            ? "kein Code"
                            : `exit ${session.exitCode}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {/* -- Fertigstellung ------------------------------------------------ */}
          <section className="stats-tile">
            <header className="usage-head">
              <h3 className="section-title">Fertigstellung</h3>
              <span className="usage-badge" title={estimateTitle}>
                geschätzt
              </span>
            </header>
            {completion.percent === null ? (
              <p className="usage-empty">
                Nichts zu schätzen: dieses Projekt hat weder Worker noch Queue-Einträge.
              </p>
            ) : (
              <>
                <div className="stats-bar" title={estimateTitle}>
                  <span className="usage-context-track">
                    <span
                      className="usage-context-fill"
                      style={{ width: `${Math.round(completion.percent)}%` }}
                    />
                  </span>
                  <span className="stats-bar-label">
                    {Math.round(completion.percent)} % geschätzt
                  </span>
                </div>
                <ul className="usage-list">
                  {completion.components.map((part) => (
                    <li key={part.key} className="usage-row">
                      <span className="usage-name">{label(COMPONENT_LABELS, part.key)}</span>
                      <span className="usage-detail">{part.detail}</span>
                      <span className="usage-budget">
                        {Math.round(part.score * 100)} % · Anteil {Math.round(part.weight * 100)} %
                      </span>
                    </li>
                  ))}
                </ul>
                <ul className="usage-list">
                  {completion.workers.map((worker) => (
                    <li key={worker.workerId} className="usage-row">
                      <span className="usage-name" title={worker.task}>
                        {worker.task === "" ? worker.workerId : worker.task}
                      </span>
                      <span className="usage-state usage-state-unknown">
                        {label(COLUMN_LABELS, worker.column)}
                      </span>
                      <span className="usage-budget">Gewicht {worker.weight.toFixed(1)}</span>
                    </li>
                  ))}
                </ul>
                <p className="usage-empty stats-note">
                  Eine Schätzung aus dem Board, kein Fortschritt „laut Plan": ein
                  maschinenlesbares Plan-Artefakt pro Projekt gibt es nicht. Die Rechenweise steht
                  im Tooltip.
                </p>
              </>
            )}
          </section>
        </div>

        {/* -- Aktivität ----------------------------------------------------- */}
        {/* Outside the tile grid on purpose. It used to sit inside it, spanning
            `1 / -1` - which stopped `auto-fit` collapsing the tracks no tile
            filled, so on a wide window the four tiles above stopped two thirds
            of the way across and the rest stayed blank. */}
        <section className="stats-tile stats-tile-full">
          <header className="usage-head">
            <h3 className="section-title">Aktivität</h3>
            <span className="usage-detail">Nachrichten und Status-Ereignisse je Tag (UTC)</span>
          </header>
          {busiestDay === 0 ? (
            <p className="usage-empty">Keine Aktivität in diesem Zeitraum.</p>
          ) : (
            <ol className="stats-timeline">
              {timeline.map((day) => {
                const total = day.messages + day.statusEvents;
                return (
                  <li
                    key={day.date}
                    className="stats-day"
                    title={`${day.date}: ${day.messages} Nachricht(en), ${day.statusEvents} Ereignis(se)`}
                  >
                    <span className="stats-day-bars">
                      <span
                        className="stats-day-bar stats-day-bar-messages"
                        style={{ height: `${(day.messages / busiestDay) * 100}%` }}
                      />
                      <span
                        className="stats-day-bar stats-day-bar-events"
                        style={{ height: `${(day.statusEvents / busiestDay) * 100}%` }}
                      />
                    </span>
                    <span className="stats-day-label">{dayLabel(day.date)}</span>
                    <span className="stats-day-count">{total}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
