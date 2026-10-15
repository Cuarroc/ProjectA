import { Button } from "../design/controls/Button";
import { t } from "../i18n/useT";
import "../design/tokens.css";
import "../design/controls/controls.css";
import styles from "./RecoveryScreen.module.css";

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
      <main className={styles.screen}>
        <section className={styles.card} role="alert" aria-labelledby="bootstrap-title">
          <span className={styles.mark} aria-hidden="true">
            ◆
          </span>
          <h1 className={styles.title} id="bootstrap-title">{t("bootstrap.failed")}</h1>
          <p className={styles.hint}>{t("bootstrap.retryHint")}</p>
          <Button variant="primary" autoFocus onClick={onRetry}>
            {t("bootstrap.retry")}
          </Button>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.screen} aria-busy="true">
      <section className={styles.card} role="status" aria-live="polite" aria-labelledby="bootstrap-title">
        <span className={styles.mark} aria-hidden="true">
          ◆
        </span>
        <div className={styles.spinner} aria-hidden="true" />
        <h1 className={styles.title} id="bootstrap-title">{t("shell.brand")}</h1>
        <p className={styles.hint}>{t("bootstrap.loading")}</p>
      </section>
    </main>
  );
}
