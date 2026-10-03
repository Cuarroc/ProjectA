import type { UpdaterState } from "../../lib/ipc";

/**
 * State, update check, install and relaunch handlers stay in `SettingsView`;
 * this tab only renders the "Updates" panel.
 */
export interface UpdatesTabProps {
  appVersion: string | null;
  versionFailed: boolean;
  updateState: UpdaterState;
  relaunchFailed: boolean;
  handleCheckUpdates: () => void;
  handleInstallUpdate: () => void;
  handleRelaunch: () => void;
}

export default function UpdatesTab({
  appVersion,
  versionFailed,
  updateState,
  relaunchFailed,
  handleCheckUpdates,
  handleInstallUpdate,
  handleRelaunch,
}: UpdatesTabProps) {
  return (
    <>
      <div className="settings-field">
        <span className="field-label">Current version</span>
        <p className="settings-hint">
          {versionFailed
            ? "Not available outside the desktop app."
            : `ProjectA ${appVersion ?? "…"}`}
        </p>
      </div>

      <div className="settings-field">
        <span className="field-label">Update check</span>
        <p className="settings-hint">
          The update feed is the public mirror repository
          Cuarroc/ProjectA-updates — update checks run anonymously and
          never need a GitHub token.
        </p>
        <div>
          <button
                type="button"
                className="button-primary"
                disabled={updateState.phase === "checking"}
                onClick={handleCheckUpdates}
              >
                {updateState.phase === "checking" ? "Checking…" : "Check for updates"}
              </button>
            </div>
            {updateState.phase === "up-to-date" ? (
              <p className="settings-hint">
                ProjectA is up to date
                {updateState.version === null ? "." : ` (${updateState.version}).`}
              </p>
            ) : null}
            {updateState.phase === "available" ? (
              <>
                <p className="settings-hint">
                  Version {updateState.version} is available
                  {appVersion === null ? "." : ` (current: ${appVersion}).`}
                </p>
                {updateState.notes === null ? null : (
                  <pre className="masterprompt-preview">{updateState.notes}</pre>
                )}
                {updateState.activeWorkers > 0 ? (
                  <p className="settings-hint">
                    {updateState.activeWorkers}{" "}
                    {updateState.activeWorkers === 1 ? "worker is" : "workers are"}{" "}
                    active — updates install only when no workers are running.
                  </p>
                ) : (
                  <div>
                    <button
                      type="button"
                      className="button-primary"
                      onClick={handleInstallUpdate}
                    >
                      Download and install
                    </button>
                  </div>
                )}
              </>
            ) : null}
            {updateState.phase === "installing" ? (
              <p className="settings-hint">
                Downloading and installing {updateState.version}…
              </p>
            ) : null}
            {updateState.phase === "ready" ? (
              <>
                <p className="settings-hint">
                  Version {updateState.version} is installed — restart to apply.
                </p>
                {relaunchFailed ? (
                  <p className="settings-hint">
                    Please restart ProjectA to apply the update.
                  </p>
                ) : (
                  <div>
                    <button
                      type="button"
                      className="button-primary"
                      onClick={handleRelaunch}
                    >
                      Restart to apply
                    </button>
                  </div>
                )}
              </>
            ) : null}
            {updateState.phase === "error" ? (
              <span className="settings-error">{updateState.message}</span>
            ) : null}
      </div>
    </>
  );
}
