import { useEffect, useLayoutEffect, useState } from "react";

import EmergencyStop from "../components/EmergencyStop";
import { useFeatureFlag } from "../flags/useFeatureFlag";
import "../design/tokens.css";
import "../design/glass.css";
import "../design/motion.css";
import "../design/variants/variants.css";
import "../design/controls/controls.css";
import { useT } from "../i18n/useT";
import { applyStoredMotionMode } from "../design/motion/motionMode";
import { applyStoredGlassVariant } from "../design/variants/useGlassVariant";
import { AppearanceControl } from "./AppearanceControl";
import { HeaderTools, StopBand } from "./header";
import { ProjectPicker } from "./header/ProjectPicker";
import { AREAS, isHidden, pathFromHash, resolveRoute, visibleRoutes, type ShellRoute } from "./routes";
import { applyStoredGlassTheme } from "./theme";
import "./shell.css";

function Sidebar({ active }: { active: ShellRoute | null }) {
  const t = useT();
  const routes = visibleRoutes();
  // One link per area with a visible route; it opens the first one and is current on every member route.
  const entries = AREAS.flatMap((area) => {
    const first = routes.find((r) => r.area === area.id);
    return first ? [{ area, first }] : [];
  });
  const link = ({ area, first }: (typeof entries)[number]) => (
    <a key={area.id} href={`#${first.path}`} className="g-shell-link" aria-current={active?.area === area.id ? "page" : undefined}>
      <svg className="g-shell-ic" viewBox="0 0 20 20" aria-hidden="true"><path d={first.icon ?? ""} /></svg>{t(area.label)}
    </a>
  );
  return (
    <nav className="g-shell-side g-chrome" aria-label={t("nav.aria")}>
      <div className="g-shell-brand"><b>{t("shell.brand")}</b><small>2.0</small></div>
      <div className="g-shell-nav">{entries.slice(0, -1).map(link)}</div>
      <div className="g-shell-nav g-shell-foot">{entries.slice(-1).map(link)}</div>
    </nav>
  );
}

/** Placeholder until the screen package of the route lands: says plainly that nothing is connected. */
function Placeholder({ path }: { path: string }) {
  const t = useT();
  const found = resolveRoute(path);
  const hidden = isHidden(path);
  const title = found ? [found.route.label, found.tab?.label].filter(Boolean).join(t("shell.titleSep")) : t("shell.unknownPage");
  return (
    <section className="g-shell-panel g-glass" aria-labelledby="g-shell-title">
      {found?.route.tabs.length && !hidden ? (
        <nav className="g-shell-tabs" aria-label={t("tab.aria")}>
          {found.route.tabs.map((tab) => (
            <a key={tab.path} href={`#${tab.path}`} aria-current={tab === found.tab ? "page" : undefined}>{tab.label}</a>
          ))}
        </nav>
      ) : null}
      <h1 id="g-shell-title">{title}</h1>
      <p className="g-shell-note">{hidden ? t("shell.hidden") : found ? t("shell.notConnected") : t("shell.unknownAddress")}</p>
      {hidden ? <a className="g-btn g-btn--ghost g-btn--sm" href="#/einstellungen">{t("shell.hiddenSettings")}</a> : null}
    </section>
  );
}

/** Glass shell frame (V2-F8a). Palette, quota bar, bell and stop band: `header/` (V2-F8b). */
export function Shell() {
  const [path, setPath] = useState(() => pathFromHash(window.location.hash));
  useLayoutEffect(() => { applyStoredGlassTheme(); applyStoredGlassVariant(); applyStoredMotionMode(); }, []);
  useEffect(() => {
    const onHash = () => setPath(pathFromHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useFeatureFlag("weitere_bereiche"); // re-render so a hidden area follows the flag
  const active = isHidden(path) ? null : resolveRoute(path)?.route ?? null;

  return (
    <div className="g-shell">
      <Sidebar active={active} />
      <div className="g-shell-main">
        <header className="g-shell-top g-chrome">
          <ProjectPicker />
          <HeaderTools />
          <AppearanceControl motion={false} />
          <span className="g-shell-divider" aria-hidden="true" />
          <div className="g-shell-estop"><EmergencyStop /></div>
        </header>
        <StopBand />
        <main className="g-shell-content"><Placeholder path={path} /></main>
      </div>
    </div>
  );
}
