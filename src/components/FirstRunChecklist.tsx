import { PROVIDER_POLL_MS, useProviderOverview } from "../lib/providers";

interface FirstRunChecklistProps {
  /** Whether at least one project exists. */
  hasProject: boolean;
  /** Whether a project is selected, so a worker can be started in it. */
  hasActiveProject: boolean;
  onOpenProviders: () => void;
  onNewWorker: () => void;
}

/**
 * Three steps for the empty main area. Step 3 is a fixed call to action, not
 * derived from data (it never shows as done). Nothing is stored: every step is
 * derived from live data on each render, so the list can never disagree with
 * the app about what is already done.
 */
export default function FirstRunChecklist({
  hasProject,
  hasActiveProject,
  onOpenProviders,
  onNewWorker,
}: FirstRunChecklistProps) {
  const { providers, loading, error } = useProviderOverview(PROVIDER_POLL_MS);
  const agentReady = providers.some((provider) => provider.connected);
  const missing = providers.filter((provider) => !provider.connected).map((provider) => provider.name);

  // Only real first-run signals: no project at all or no connected agent.
  // While providers are still loading nothing is known, so nothing is shown.
  if (loading || (hasProject && agentReady)) return null;

  let agentHint: string | null = null;
  if (!agentReady) {
    agentHint = error
      ? "Agenten-Status konnte nicht gelesen werden."
      : missing.length > 0
        ? `Noch nicht verbunden: ${missing.join(", ")}`
        : "Kein Agent bekannt.";
  }

  return (
    <ol className="first-run" role="list" aria-label="Erste Schritte">
      <li className="first-run-step" data-done={hasProject}>
        <span className="first-run-mark" aria-hidden="true">
          {hasProject ? "✓" : "○"}
        </span>
        <div className="first-run-body">
          <strong>Projekt anlegen (ein Git-Ordner)</strong>
          {hasProject ? null : <span className="first-run-hint">Über das + in der Seitenleiste.</span>}
        </div>
      </li>
      <li className="first-run-step" data-done={agentReady}>
        <span className="first-run-mark" aria-hidden="true">
          {agentReady ? "✓" : "○"}
        </span>
        <div className="first-run-body">
          <strong>Ein Agent ist bereit</strong>
          {agentHint ? <span className="first-run-hint">{agentHint}</span> : null}
        </div>
        {agentReady ? null : (
          <button type="button" className="empty-action-ghost" onClick={onOpenProviders}>
            Anbieter öffnen
          </button>
        )}
      </li>
      <li className="first-run-step" data-done={false}>
        <span className="first-run-mark" aria-hidden="true">
          ○
        </span>
        <div className="first-run-body">
          <strong>Erste kleine Aufgabe</strong>
        </div>
        <button type="button" className="empty-action" disabled={!hasActiveProject} onClick={onNewWorker}>
          Neuer Worker
        </button>
      </li>
    </ol>
  );
}
