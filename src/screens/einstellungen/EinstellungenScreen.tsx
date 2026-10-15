import { useState, type ReactNode } from "react";
import "../../design/controls/controls.css";
import "../../design/glass.css";
import "../../design/layout/layout.css";

import EmergencyStop from "../../components/EmergencyStop";
import { Button } from "../../design/controls/Button";
import { HonestState } from "../../design/data/HonestState";
import { TabPanel, Tabs } from "../../design/layout/Tabs";
import { listFeatureFlags, type FeatureFlag } from "../../flags/featureFlags";
import { useFeatureFlag } from "../../flags/useFeatureFlag";
import { AppearanceControl } from "../../shell/AppearanceControl";
import { ROUTES } from "../../shell/routes";
import { DiagnoseSection } from "./DiagnoseSection";
import { T } from "./texts";
import { TresorPanel } from "./tresor/TresorPanel";
import { VersionUpdates } from "./VersionUpdates";
import { VersionChangelog } from "./version/VersionChangelog";
import "./einstellungen.css";

const TABS = ROUTES.find((r) => r.id === "einstellungen")!.tabs.map((t) => ({
  id: t.path.split("/")[2] ?? "allgemein",
  label: t.label,
}));

const Section = ({ title, hint, className = "", children }: { title: string; hint?: string; className?: string; children: ReactNode }) => (
  <section className={`es-sec g-glass ${className}`.trim()} aria-label={title}>
    <h2>{title}</h2>
    {hint ? <p className="es-note">{hint}</p> : null}
    {children}
  </section>
);

function PreviewFlagRow({ flag }: { flag: FeatureFlag }) {
  const [enabled, setEnabled] = useFeatureFlag(flag.id);
  const id = `es-preview-${flag.id}`;
  return (
    <li className="es-preview-row">
      <div className="es-preview-control">
        <label className="settings-check" htmlFor={id}>
          <input id={id} type="checkbox" checked={enabled} aria-describedby={`${id}-description`}
            onChange={(event) => setEnabled(event.target.checked)} />
          <span>{flag.label}</span>
        </label>
        <span className="es-note">{enabled ? T.previewOn : T.previewOff}</span>
      </div>
      <p className="es-note" id={`${id}-description`}>{flag.description}</p>
    </li>
  );
}

/** Einstellungen of the Glass shell: tab strip and the tab Allgemein. */
export function EinstellungenScreen({ onOpenClassic }: { onOpenClassic: () => void }) {
  const [tab, setTab] = useState(TABS[0].id);
  return (
    <div className="es">
      <Tabs idBase="es" tabs={TABS} value={tab} onChange={setTab} aria-label={T.tabs} />
      {TABS.map((t) => (
        <TabPanel key={t.id} idBase="es" id={t.id} active={t.id === tab}>
          {t.id === TABS[0].id ? (
            <div className="es-grid">
              <Section title={T.appearance} hint={T.appearanceHint}>
                <AppearanceControl />
              </Section>
              <Section title={T.preview}>
                <ul className="es-preview-list">
                  {listFeatureFlags().map((flag) => <PreviewFlagRow key={flag.id} flag={flag} />)}
                </ul>
              </Section>
              <Section title={T.version}><VersionUpdates /><VersionChangelog /></Section>
              <Section title={T.diag} hint={T.diagHint}><DiagnoseSection /></Section>
              <Section title={T.stop} className="es-sec--stop"><EmergencyStop appearance="glass" /></Section>
              <Section title={T.more} hint={T.moreHint}>
                <Button size="sm" onClick={onOpenClassic}>{T.moreOpen}</Button>
              </Section>
            </div>
          ) : t.id === "mcp" ? (
            <TresorPanel />
          ) : (
            <HonestState kind="offline" hint={T.tabHint} />
          )}
        </TabPanel>
      ))}
    </div>
  );
}
