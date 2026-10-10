import { useEffect, useLayoutEffect, useState } from "react";

import EmergencyStop from "../components/EmergencyStop";
import "../design/tokens.css";
import "../design/glass.css";
import "../design/variants/variants.css";
import "../design/controls/controls.css";
import { applyStoredGlassVariant } from "../design/variants/useGlassVariant";
import { AppearanceControl } from "./AppearanceControl";
import { HeaderTools, StopBand } from "./header";
import { pathFromHash, resolveRoute, ROUTES, type ShellRoute } from "./routes";
import { applyStoredGlassTheme } from "./theme";
import "./shell.css";

function Sidebar({ active }: { active: ShellRoute | null }) {
  const link = (r: ShellRoute) => (
    <a key={r.id} href={`#${r.path}`} className="g-shell-link" aria-current={r === active ? "page" : undefined}>
      <svg className="g-shell-ic" viewBox="0 0 20 20" aria-hidden="true"><path d={r.icon ?? ""} /></svg>{r.label}
    </a>
  );
  const entries = ROUTES.filter((r) => r.icon !== null);
  return (
    <nav className="g-shell-side g-chrome" aria-label="Hauptnavigation">
      <div className="g-shell-brand"><b>ProjectA</b><small>2.0</small></div>
      <div className="g-shell-nav">{entries.slice(0, -1).map(link)}</div>
      <div className="g-shell-nav g-shell-foot">{entries.slice(-1).map(link)}</div>
    </nav>
  );
}

/** Placeholder until the screen package of the route lands: says plainly that nothing is connected. */
function Placeholder({ path }: { path: string }) {
  const found = resolveRoute(path);
  const title = found ? [found.route.label, found.tab?.label].filter(Boolean).join(" · ") : "Unbekannte Seite";
  return (
    <section className="g-shell-panel g-glass" aria-labelledby="g-shell-title">
      {found?.route.tabs.length ? (
        <nav className="g-shell-tabs" aria-label="Bereiche">
          {found.route.tabs.map((t) => (
            <a key={t.path} href={`#${t.path}`} aria-current={t === found.tab ? "page" : undefined}>{t.label}</a>
          ))}
        </nav>
      ) : null}
      <h1 id="g-shell-title">{title}</h1>
      <p className="g-shell-note">{found ? "Noch nicht verbunden: dieser Bildschirm kommt mit seinem eigenen Paket." : "Diese Adresse gibt es nicht."}</p>
    </section>
  );
}

/** Glass shell frame (V2-F8a). Palette, quota bar, bell and stop band: `header/` (V2-F8b). */
export function Shell() {
  const [path, setPath] = useState(() => pathFromHash(window.location.hash));
  useLayoutEffect(() => { applyStoredGlassTheme(); applyStoredGlassVariant(); }, []);
  useEffect(() => {
    const onHash = () => setPath(pathFromHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const active = resolveRoute(path)?.route ?? null;

  return (
    <div className="g-shell">
      <Sidebar active={active} />
      <div className="g-shell-main">
        <header className="g-shell-top g-chrome">
          <button type="button" className="g-shell-pick" disabled aria-label="Projekt wechseln: noch nicht verbunden">Projekt</button>
          <HeaderTools />
          <AppearanceControl />
          <span className="g-shell-divider" aria-hidden="true" />
          <div className="g-shell-estop"><EmergencyStop /></div>
        </header>
        <StopBand />
        <main className="g-shell-content"><Placeholder path={path} /></main>
      </div>
    </div>
  );
}
