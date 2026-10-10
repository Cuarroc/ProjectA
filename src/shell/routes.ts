// V2-F8a: route registry of the Glass shell, from docs/plan/v2.0/ia.md sections 1 and 3.
// Not imported by the app until V2-F9.

import { de, type MessageKey } from "../i18n/de";

export interface ShellTab { path: string; label: string }

export interface ShellRoute {
  id: string;
  label: string;
  /** Sidebar link target (the default tab); every path below `base` belongs to the entry. */
  path: string;
  base: string;
  /** SVG path data of the 20x20 sidebar icon; Ersteinrichtung (`/start`) has no sidebar entry. */
  icon: string | null;
  tabs: readonly ShellTab[];
}

const t = (path: string, label: MessageKey): ShellTab => ({ path, label: de[label] });
const r = (id: string, label: MessageKey, path: string, icon: string | null, tabs: ShellTab[] = []): ShellRoute =>
  ({ id, label: de[label], path, base: `/${path.split("/")[1]}`, icon, tabs });

export const ROUTES: readonly ShellRoute[] = [
  r("leitstand", "nav.leitstand", "/leitstand", "M3.5 13.5a6.5 6.5 0 1 1 13 0M10 13.5l3-5",
    [t("/leitstand", "tab.main"), t("/leitstand/verlauf", "tab.history")]),
  r("eingang", "nav.eingangPlan", "/eingang/plan", "M5 17.5v-14M5 4h9.5l-2 3.5 2 3.5H5",
    [t("/eingang/plan", "tab.plan"), t("/eingang/ideen", "tab.ideas"), t("/eingang/bugs", "tab.bugs")]),
  r("beweise", "nav.beweise", "/beweise", "M10 2.5 16 5v4.5c0 3.8-2.6 6.6-6 8-3.4-1.4-6-4.2-6-8V5ZM7.3 10l1.9 1.9 3.6-3.8",
    [t("/beweise", "tab.main"), t("/beweise/diff", "tab.diff")]),
  r("team", "nav.team", "/team", "M7 5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM2.5 16c.6-2.6 2.4-4 4.5-4s3.9 1.4 4.5 4M13.5 7a2 2 0 1 1 0 4M12 12.2c2.2-.3 4 .9 4.8 3.3",
    [t("/team", "tab.org"), t("/team/personas", "tab.personas"), t("/team/generator", "tab.generator")]),
  r("automatik", "nav.automatik", "/automatik", "M11 2.5 4.5 11H10l-1 6.5L15.5 9H10Z",
    [t("/automatik", "tab.trigger"), t("/automatik/befehle", "tab.commands"), t("/automatik/ablaeufe", "tab.flows")]),
  r("core", "nav.core", "/core", "M10 2.5 16.5 6.25v7.5L10 17.5 3.5 13.75v-7.5ZM10 7.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z"),
  r("steuerung", "nav.steuerung", "/steuerung", "M3 10a7 7 0 1 1 14 0 7 7 0 0 1-14 0ZM10 10V6M10 10l3 2",
    [t("/steuerung", "tab.quotas"), t("/steuerung/verbesserungen", "tab.improvements"), t("/steuerung/autonomie", "tab.autonomy")]),
  r("gedaechtnis", "nav.gedaechtnis", "/gedaechtnis", "M4 16.5v-12A1.5 1.5 0 0 1 5.5 3H16v12H5.5A1.5 1.5 0 0 0 4 16.5 1.5 1.5 0 0 0 5.5 18H16M8 7h5"),
  r("einstellungen", "nav.einstellungen", "/einstellungen", "M4 6h7M15 6h1M4 14h1M9 14h7M13 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM7 12a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z",
    [t("/einstellungen", "tab.general"), t("/einstellungen/mcp", "tab.mcp"),
      t("/einstellungen/benachrichtigungen", "tab.notifications"), t("/einstellungen/projekt", "tab.project")]),
  r("start", "nav.start", "/start", null),
];

export const DEFAULT_PATH = "/leitstand";

export interface ResolvedRoute { route: ShellRoute; tab: ShellTab | null }

/** Exact entry or tab path first, then the entry whose base contains the path; null = unknown. */
export function resolveRoute(path: string): ResolvedRoute | null {
  const clean = path.replace(/\/+$/, "");
  for (const route of ROUTES) {
    const tab = route.tabs.find((x) => x.path === clean);
    if (tab || route.path === clean) return { route, tab: tab ?? null };
  }
  const route = ROUTES.find((x) => clean.startsWith(`${x.base}/`));
  return route ? { route, tab: null } : null;
}

/** `#/beweise/diff` to `/beweise/diff`; an empty hash opens the default route. */
export function pathFromHash(hash: string): string {
  const raw = hash.replace(/^#/, "");
  return raw.startsWith("/") ? raw : DEFAULT_PATH;
}
