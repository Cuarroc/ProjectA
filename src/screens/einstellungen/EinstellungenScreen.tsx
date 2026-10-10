import { useState, type ReactNode } from "react";
import "../../design/controls/controls.css";
import "../../design/glass.css";
import "../../design/layout/layout.css";

import EmergencyStop from "../../components/EmergencyStop";
import { Button } from "../../design/controls/Button";
import { HonestState } from "../../design/data/HonestState";
import { TabPanel, Tabs } from "../../design/layout/Tabs";
import { AppearanceControl } from "../../shell/AppearanceControl";
import PreviewToggle from "../../shell/mount/PreviewToggle";
import { ROUTES } from "../../shell/routes";
import { T } from "./texts";
import { VersionUpdates } from "./VersionUpdates";
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

/** Einstellungen of the Glass shell: tab strip and the tab Allgemein. Not mounted yet: the route comes with a later package. */
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
              <Section title={T.preview}><PreviewToggle /></Section>
              <Section title={T.version}><VersionUpdates /></Section>
              <Section title={T.stop} className="es-sec--stop"><EmergencyStop /></Section>
              <Section title={T.more} hint={T.moreHint}>
                <Button size="sm" onClick={onOpenClassic}>{T.moreOpen}</Button>
              </Section>
            </div>
          ) : (
            <HonestState kind="offline" hint={T.tabHint} />
          )}
        </TabPanel>
      ))}
    </div>
  );
}
