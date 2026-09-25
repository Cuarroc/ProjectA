import { useEffect, useState } from "react";

import UsageView from "./UsageView";
import StatisticsView from "./StatisticsView";
import ActivityView from "./ActivityView";
import { describeError, getResourceSnapshot, type ResourceSnapshot } from "../lib/ipc";
import type { AgentProfile, BoardCard, Worker } from "../types";

interface InsightsViewProps {
  profiles: AgentProfile[];
  cards: BoardCard[];
  workers: Worker[];
  projectId: string | null;
}

/**
 * F2 Insights: usage, statistics and the activity feed on one surface.
 * Each child keeps its own loading/empty/error; this wrapper does not invent
 * a second scope.
 */
export default function InsightsView({
  profiles,
  cards,
  workers,
  projectId,
}: InsightsViewProps) {
  return (
    <div className="insights-area" data-testid="insights">
      <p className="insights-scope">
        Scope: {projectId === null ? "kein Projekt — Usage bleibt flottenweit lesbar" : "aktives Projekt"}
      </p>
      <section className="insights-section" aria-label="Ressourcen">
        <ResourceBaseline />
      </section>
      <section className="insights-section" aria-label="Usage">
        <UsageView profiles={profiles} cards={cards} workers={workers} />
      </section>
      <section className="insights-section" aria-label="Statistik">
        <StatisticsView projectId={projectId} />
      </section>
      <section className="insights-section" aria-label="Aktivität">
        <ActivityView projectId={projectId} />
      </section>
    </div>
  );
}

function formatBytes(value: number | null): string {
  if (value === null) return "nicht gemessen";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}

function formatCpu(permille: number | null): string {
  if (permille === null) return "nicht gemessen";
  return `${(permille / 10).toFixed(1)} %`;
}

function ResourceBaseline() {
  const [snap, setSnap] = useState<ResourceSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void getResourceSnapshot()
        .then((next) => {
          if (cancelled) return;
          setSnap(next);
          setError(null);
        })
        .catch((cause: unknown) => {
          if (cancelled) return;
          setError(describeError(cause));
        });
    };
    load();
    const timer = window.setInterval(load, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div data-testid="insights-resources">
      <h2 className="insights-heading">Ressourcen</h2>
      <p className="insights-scope">
        Messbasis vor Grenzwerten — fehlende Werte sind nicht null.
      </p>
      {error ? <p className="settings-error">{error}</p> : null}
      {snap ? (
        <dl className="insights-resources">
          <div>
            <dt>CPU</dt>
            <dd>{formatCpu(snap.cpuPermille)}</dd>
          </div>
          <div>
            <dt>RAM Prozess</dt>
            <dd>{formatBytes(snap.ramProcessBytes)}</dd>
          </div>
          <div>
            <dt>RAM gesamt</dt>
            <dd>{formatBytes(snap.ramTotalBytes)}</dd>
          </div>
          <div>
            <dt>Disk AppData</dt>
            <dd>{formatBytes(snap.diskAppBytes)}</dd>
          </div>
          <div>
            <dt>Disk frei</dt>
            <dd>{formatBytes(snap.diskFreeBytes)}</dd>
          </div>
          <div>
            <dt>Tokens</dt>
            <dd>
              {snap.tokensIn.toLocaleString()} ein / {snap.tokensOut.toLocaleString()} aus
            </dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}
