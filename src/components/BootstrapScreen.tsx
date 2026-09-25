interface BootstrapScreenProps {
  /** The initial project read failed; retry is safe because it only reads state. */
  error: boolean;
  onRetry: () => void;
}

/**
 * The app's first honest state: no workspace is shown until its project list
 * has either arrived or failed. It deliberately reports no fake progress.
 */
export default function BootstrapScreen({ error, onRetry }: BootstrapScreenProps) {
  if (error) {
    return (
      <main className="bootstrap-screen">
        <section className="bootstrap-card" role="alert" aria-labelledby="bootstrap-title">
          <span className="bootstrap-mark" aria-hidden="true">
            ◆
          </span>
          <h1 id="bootstrap-title">Arbeitsbereich konnte nicht geladen werden</h1>
          <p>Prüfe die Verbindung zur App und versuche es erneut.</p>
          <button type="button" className="bootstrap-retry" autoFocus onClick={onRetry}>
            Erneut versuchen
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="bootstrap-screen" aria-busy="true">
      <section className="bootstrap-card" role="status" aria-live="polite" aria-labelledby="bootstrap-title">
        <span className="bootstrap-mark" aria-hidden="true">
          ◆
        </span>
        <div className="bootstrap-spinner" aria-hidden="true" />
        <h1 id="bootstrap-title">ProjectA</h1>
        <p>Arbeitsbereich wird geladen …</p>
      </section>
    </main>
  );
}
