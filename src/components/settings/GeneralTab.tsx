import { useState } from "react";

import { describeError, deleteSessionBuffers, type AgentEnvStage, type ProductMode, type RoutingStatus } from "../../lib/ipc";
import {
  saveTerminalFont,
  saveTerminalFontSize,
  saveUiDensity,
  saveUiFontSize,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  TERMINAL_FONTS,
  type FontSettings,
  type TerminalFontId,
  type UiDensity,
  type UiFontSize,
} from "../../lib/settings";
import type { Project } from "../../types";
import EmergencyStop from "../EmergencyStop";

/**
 * State and handlers stay in `SettingsView` (they share effects with the other
 * tabs); this tab only renders the "Allgemein" panel.
 */
export interface GeneralTabProps {
  density: UiDensity;
  onDensityChange: (density: UiDensity) => void;
  fonts: FontSettings;
  onFontsChange: (fonts: FontSettings) => void;
  project: Project | null;
  portInput: string;
  setPortInput: (value: string) => void;
  portError: string | null;
  handleSavePort: () => void;
  digestEnabled: boolean;
  handleToggleDigest: (enabled: boolean) => void;
  digestError: string | null;
  envStage: AgentEnvStage;
  handleEnvStage: (stage: AgentEnvStage) => void;
  envStageError: string | null;
  stuckInput: string;
  setStuckInput: (value: string) => void;
  savingStuck: boolean;
  handleSaveStuck: () => void;
  stuckError: string | null;
  routing: RoutingStatus | null;
  savingRouting: boolean;
  routingError: string | null;
  handleProductMode: (mode: ProductMode) => void;
  testCommandInput: string;
  setTestCommandInput: (value: string) => void;
  savingTestCommand: boolean;
  handleSaveTestCommand: () => void;
  testCommandError: string | null;
  setupCommandInput: string;
  setSetupCommandInput: (value: string) => void;
  setupCommandLoadedFor: string | null;
  savingSetupCommand: boolean;
  handleSaveSetupCommand: () => void;
  setupCommandError: string | null;
  setSetupLoadAttempt: (update: (n: number) => number) => void;
  maxWorkersInput: string;
  setMaxWorkersInput: (value: string) => void;
  savingMaxWorkers: boolean;
  handleSaveMaxWorkers: () => void;
  maxWorkersError: string | null;
}

export default function GeneralTab({
  density,
  onDensityChange,
  fonts,
  onFontsChange,
  project,
  portInput,
  setPortInput,
  portError,
  handleSavePort,
  digestEnabled,
  handleToggleDigest,
  digestError,
  envStage,
  handleEnvStage,
  envStageError,
  stuckInput,
  setStuckInput,
  savingStuck,
  handleSaveStuck,
  stuckError,
  routing,
  savingRouting,
  routingError,
  handleProductMode,
  testCommandInput,
  setTestCommandInput,
  savingTestCommand,
  handleSaveTestCommand,
  testCommandError,
  setupCommandInput,
  setSetupCommandInput,
  setupCommandLoadedFor,
  savingSetupCommand,
  handleSaveSetupCommand,
  setupCommandError,
  setSetupLoadAttempt,
  maxWorkersInput,
  setMaxWorkersInput,
  savingMaxWorkers,
  handleSaveMaxWorkers,
  maxWorkersError,
}: GeneralTabProps) {
  return (
    <>
      <EmergencyStop />

      <fieldset className="settings-field settings-density">
        <legend className="field-label">Darstellungsdichte</legend>
        <div className="settings-density-options">
          {(["comfortable", "compact"] as const).map((value) => (
            <label className="settings-check" key={value}>
              <input
                type="radio"
                name="settings-density"
                value={value}
                checked={density === value}
                onChange={() => {
                  saveUiDensity(value);
                  onDensityChange(value);
                }}
              />
              <span>{value === "comfortable" ? "Komfortabel" : "Kompakt"}</span>
            </label>
          ))}
        </div>
        <p className="settings-hint">Passt Abstände und Bedienelemente in der App an.</p>
      </fieldset>
      <fieldset className="settings-field settings-density">
        <legend className="field-label">Schriftgröße der App</legend>
        <div className="settings-density-options">
          {(["small", "normal", "large"] as const).map((value) => (
            <label className="settings-check" key={value}>
              <input
                type="radio"
                name="settings-ui-font-size"
                value={value}
                checked={fonts.uiFontSize === value}
                onChange={() => {
                  saveUiFontSize(value);
                  onFontsChange({ ...fonts, uiFontSize: value as UiFontSize });
                }}
              />
              <span>{value === "small" ? "Klein" : value === "normal" ? "Normal" : "Groß"}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="settings-field">
        <label className="field-label" htmlFor="settings-terminal-font">
          Terminal-Schrift
        </label>
        <select
          id="settings-terminal-font"
          className="field"
          value={fonts.terminalFont}
          onChange={(event) => {
            const value = event.target.value as TerminalFontId;
            saveTerminalFont(value);
            onFontsChange({ ...fonts, terminalFont: value });
          }}
        >
          {(Object.keys(TERMINAL_FONTS) as TerminalFontId[]).map((id) => (
            <option key={id} value={id}>
              {TERMINAL_FONTS[id].label}
            </option>
          ))}
        </select>
      </div>
      <div className="settings-field">
        <label className="field-label" htmlFor="settings-terminal-font-size">
          Terminal-Schriftgröße: {fonts.terminalFontSize}
        </label>
        <input
          id="settings-terminal-font-size"
          type="range"
          min={TERMINAL_FONT_SIZE_MIN}
          max={TERMINAL_FONT_SIZE_MAX}
          step={1}
          value={fonts.terminalFontSize}
          onChange={(event) => {
            const value = Number(event.target.value);
            saveTerminalFontSize(value);
            onFontsChange({ ...fonts, terminalFontSize: value });
          }}
        />
        <p className="settings-hint">Gilt sofort in allen offenen Terminals.</p>
      </div>
      <div className="settings-field">
        <label className="field-label" htmlFor="settings-web-port">
          Default Port Web-Interface
        </label>
        <div className="settings-port-row">
          <input
            id="settings-web-port"
            className="field"
            inputMode="numeric"
            placeholder="z. B. 8787"
            value={portInput}
            onChange={(event) => setPortInput(event.target.value)}
          />
          <button type="button" className="button-primary" onClick={handleSavePort}>
            Speichern
          </button>
        </div>
        {portError ? <span className="settings-error">{portError}</span> : null}
      </div>

      <label className="settings-check">
        <input
          type="checkbox"
          checked={digestEnabled}
          onChange={(event) => handleToggleDigest(event.target.checked)}
        />
        <span>Tages-Digest schreiben</span>
      </label>
      <p className="settings-hint">
        Schreibt einmal pro Stunde für den Tag, der bereits vorbei ist, eine
        Markdown-Seite nach <code>&lt;repo&gt;/.pa/memory/digests/</code> — Board-Stand,
        Tagesverlauf, Worker-Aktivität, Quota und Budget. Kein Agent, keine Tokens:
        alles kommt aus Daten, die ProjectA ohnehin hat. <code>.pa/</code> ist
        gitignored, die Seiten sind Lesestoff für den Vault.
      </p>
        {digestError ? <span className="settings-error">{digestError}</span> : null}

      <fieldset className="settings-field">
        <legend className="field-label">Umgebung der Agenten</legend>
        {(
          [
            ["strict", "Streng (empfohlen)"],
            ["allowlist", "Erlaubnisliste"],
            ["inherit", "Erbt alles (schwächste Stufe)"],
          ] as const
        ).map(([value, label]) => (
          <label className="settings-check" key={value}>
            <input
              type="radio"
              name="settings-env-stage"
              value={value}
              checked={envStage === value}
              onChange={() => handleEnvStage(value)}
            />
            <span>{label}</span>
          </label>
        ))}
        <p className="settings-hint">
          Gilt für alle Projekte und nur für neue Starts und Neustarts von Agenten;
          laufende Agenten behalten ihre Umgebung. „Erbt alles“ ist die schwächste
          Stufe. Koordinatoren bleiben immer streng.
        </p>
        {envStageError ? <span className="settings-error" role="alert">{envStageError}</span> : null}
      </fieldset>

      <SessionBufferDelete />

      <div className="settings-field">
        <label className="field-label" htmlFor="settings-stuck-minutes">
          Stuck-Diagnose (Minuten)
        </label>
        <div className="settings-port-row">
          <input
            id="settings-stuck-minutes"
            className="field"
            inputMode="numeric"
            placeholder="Standard: 10"
            value={stuckInput}
            onChange={(event) => setStuckInput(event.target.value)}
          />
          <button
            type="button"
            className="button-primary"
            disabled={savingStuck}
            onClick={handleSaveStuck}
          >
            {savingStuck ? "…" : "Speichern"}
          </button>
        </div>
        <p className="settings-hint">
          Wie lange ein laufender Worker <em>gleichzeitig</em> ohne Terminal-Ausgabe
          und ohne Änderung in seinem Worktree bleiben darf, bevor die Karte als
          „vermutlich festgefahren“ auf needs_you landet. Beides zusammen ist der
          Punkt: wer liest und denkt, schreibt nichts ins Terminal; wer kompiliert,
          schreibt keine Dateien. Ein leeres Feld nimmt den Standard.
        </p>
        {stuckError ? <span className="settings-error">{stuckError}</span> : null}
      </div>

      <fieldset className="settings-field" disabled={savingRouting}>
        <legend className="field-label" id="settings-product-mode-label">
          Produktmodus (OmniRoute)
        </legend>
        <div
          className="settings-mode-row"
          role="radiogroup"
          aria-labelledby="settings-product-mode-label"
          aria-describedby={
            routing && !routing.reviewIndependent
              ? "settings-review-block"
              : undefined
          }
        >
          {(
            [
              ["reliable", "Reliable"],
              ["cheap", "Cheap"],
              ["review", "Review"],
            ] as const
          ).map(([value, label]) => (
            <label className="settings-check" key={value}>
              <input
                type="radio"
                name="settings-product-mode"
                value={value}
                checked={(routing?.mode ?? "cheap") === value}
                onChange={() => handleProductMode(value)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <p className="settings-hint">
          Reliable zielt auf die kompatible Erfolgsrate, Cheap auf geringere
          Kosten, Review auf eine unabhängige Prüfer-Familie. Review fällt
          nie still auf das Autoren-Modell zurück.
        </p>
        {routing && !routing.reviewIndependent ? (
          <p
            id="settings-review-block"
            className="settings-error"
            role="status"
            aria-live="polite"
            aria-label="Review-Blockade"
          >
            Review ist blockiert: {routing.reviewDetail || "keine unabhängige Prüfer-Familie."}
            {routing.mode === "review"
              ? " Spawn und Respawn werden verweigert, bis ein unabhängiges Combo verfügbar ist."
              : " Der Modus bleibt wählbar; ein Spawn als Review wird verweigert."}
          </p>
        ) : null}
        {routingError ? <span className="settings-error">{routingError}</span> : null}
      </fieldset>

      <div className="settings-field">
        <label className="field-label" htmlFor="settings-test-command">
          Test-Kommando{project === null ? "" : ` — ${project.name}`}
        </label>
        <div className="settings-command-row">
          <input
            id="settings-test-command"
            className="field"
            placeholder="z. B. npm test"
            disabled={project === null}
            value={testCommandInput}
            onChange={(event) => setTestCommandInput(event.target.value)}
          />
          <button
            type="button"
            className="button-primary"
            disabled={project === null || savingTestCommand}
            onClick={handleSaveTestCommand}
          >
            {savingTestCommand ? "…" : "Speichern"}
          </button>
        </div>
        <p className="settings-hint">
          Das Kommando läuft im Worktree eines Workers, sobald du auf seiner
          Board-Karte „Tests“ drückst; das Ergebnis erscheint dort als Badge. Beim
          Anlegen eines Projekts wird es automatisch erkannt. Ein leeres Feld
          entfernt das Gate — dann gibt es weder Button noch Badge.
        </p>
        {project === null ? (
          <span className="settings-hint">Kein Projekt ausgewählt.</span>
        ) : null}
        {testCommandError ? (
          <span className="settings-error">{testCommandError}</span>
        ) : null}
      </div>

      <div className="settings-field">
        <label className="field-label" htmlFor="settings-setup-command">
          Setup-Kommando{project === null ? "" : ` — ${project.name}`}
        </label>
        <div className="settings-command-row">
          <input
            id="settings-setup-command"
            className="field"
            placeholder="z. B. npm ci"
            disabled={project === null || setupCommandLoadedFor !== project.id}
            value={setupCommandInput}
            onChange={(event) => setSetupCommandInput(event.target.value)}
          />
          <button
            type="button"
            className="button-primary"
            disabled={
              project === null ||
              savingSetupCommand ||
              setupCommandLoadedFor !== project.id
            }
            onClick={handleSaveSetupCommand}
          >
            {savingSetupCommand ? "…" : "Speichern"}
          </button>
        </div>
        <p className="settings-hint">
          Das Kommando bereitet den wegwerfbaren Merge-Kandidaten vor, bevor das
          Test-Gate dort läuft. Es startet erst, nachdem du Befehl, Basis und
          deklarierte Inputs in der Review-Ansicht freigegeben hast — die Freigabe
          gilt für genau diesen Merge-Kandidaten, jede Änderung am Kommando oder am
          Baum lässt sie verfallen. Ein leeres Feld schaltet das Setup ab. Achtung: Das
          Kommando darf diese deklarierten Inputs nicht umschreiben (daher{" "}
          <code>npm ci</code> statt <code>npm install</code>) — sonst verwirft die
          Validierung jeden Lauf, weil der getestete Baum nicht mehr der
          Merge-Tree ist.
        </p>
        {setupCommandError ? (
          <span className="settings-error">
            {setupCommandError}{" "}
            {project !== null && setupCommandLoadedFor !== project.id ? (
              <button
                type="button"
                className="worker-action"
                onClick={() => setSetupLoadAttempt((n) => n + 1)}
              >
                Erneut versuchen
              </button>
            ) : null}
          </span>
        ) : null}
      </div>

      <div className="settings-field">
        <label className="field-label" htmlFor="settings-max-workers">
          Maximale Worker{project === null ? "" : ` — ${project.name}`}
        </label>
        <div className="settings-command-row">
          <input
            id="settings-max-workers"
            className="field"
            inputMode="numeric"
            placeholder="leer = Standard, 0 = aus"
            disabled={project === null || savingMaxWorkers}
            value={maxWorkersInput}
            onChange={(event) => setMaxWorkersInput(event.target.value)}
          />
          <button
            type="button"
            className="button-primary"
            disabled={project === null || savingMaxWorkers}
            onClick={handleSaveMaxWorkers}
          >
            {savingMaxWorkers ? "…" : "Speichern"}
          </button>
        </div>
        <p className="settings-hint">
          Wie viele Worker dieses Projekts gleichzeitig laufen dürfen. Orchestrator,
          Queen und Scout zählen nicht mit. Ein leeres Feld verwendet den Standard der
          Warteschlange. <strong>0</strong> hält den Dispatcher für dieses Projekt an;
          eingereihte Aufgaben bleiben bereit, bis das Limit wieder erhöht oder geleert
          wird. Negative Zahlen sind nicht erlaubt.
        </p>
        {project === null ? (
          <span className="settings-hint">Kein Projekt ausgewählt.</span>
        ) : null}
        {maxWorkersError ? (
          <span className="settings-error">{maxWorkersError}</span>
        ) : null}
      </div>
    </>
  );
}

function SessionBufferDelete() {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const handleDelete = () => {
    if (!confirming) {
      setConfirming(true);
      setError(null);
      setNote(null);
      return;
    }
    setBusy(true);
    setError(null);
    void deleteSessionBuffers()
      .then((dropped) => {
        setNote(
          dropped === 0
            ? "Keine Sitzungspuffer vorhanden."
            : `${dropped} Sitzungspuffer gelöscht.`,
        );
        setConfirming(false);
      })
      .catch((cause: unknown) => setError(describeError(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="settings-field">
      <p className="field-label">Sitzungspuffer</p>
      <p className="settings-hint">
        Scrollback und Composer-Drafts, höchstens sieben Tage oder 2&nbsp;MB je
        Session. Archive und Merge löschen sie automatisch; hier ist der
        manuelle DSAR-Pfad. Laufende Sitzungen schreiben ihren Puffer beim
        Beenden erneut — sie erst beenden, dann löschen.
      </p>
      <div className="settings-port-row">
        <button
          type="button"
          className="button-primary"
          disabled={busy}
          onClick={handleDelete}
        >
          {busy
            ? "…"
            : confirming
              ? "Wirklich alle Sitzungspuffer löschen"
              : "Sitzungspuffer löschen"}
        </button>
      </div>
      {note ? (
        <span className="settings-saved" role="status">
          {note}
        </span>
      ) : null}
      {error ? <span className="settings-error">{error}</span> : null}
    </div>
  );
}
