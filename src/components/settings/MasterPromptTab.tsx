/**
 * State and handlers stay in `SettingsView`; this tab only renders the
 * "Masterprompt" panel.
 */
export interface MasterPromptTabProps {
  masterPrompt: string;
  setMasterPrompt: (value: string) => void;
  masterEnabled: boolean;
  handleToggleMaster: (enabled: boolean) => void;
  handleSaveMasterPrompt: () => void;
}

export default function MasterPromptTab({
  masterPrompt,
  setMasterPrompt,
  masterEnabled,
  handleToggleMaster,
  handleSaveMasterPrompt,
}: MasterPromptTabProps) {
  return (
    <>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={masterEnabled}
          onChange={(event) => handleToggleMaster(event.target.checked)}
        />
        <span>Masterprompt für alle Agenten verwenden</span>
      </label>

      <div className="settings-field">
        <label className="field-label" htmlFor="settings-masterprompt">
          Globaler Masterprompt
        </label>
        <textarea
          id="settings-masterprompt"
          className="field field-textarea"
          rows={10}
          placeholder="Gemeinsame Regeln und Kontext für alle Agenten…"
          value={masterPrompt}
          onChange={(event) => setMasterPrompt(event.target.value)}
        />
        <div>
          <button type="button" className="button-primary" onClick={handleSaveMasterPrompt}>
            Speichern
          </button>
        </div>
      </div>

      <div className="settings-field">
        <span className="field-label">Vorschau</span>
        <pre className="masterprompt-preview">
          {masterPrompt.trim() === ""
            ? "(kein Masterprompt gesetzt)"
            : `${masterPrompt}\n\n---\n\n<Aufgabe des Agenten>`}
        </pre>
      </div>
    </>
  );
}
