import { de } from "../i18n/de";
import { readString, writeString } from "../lib/settings";

// V2-F8a theme contract: only `data-theme` on <html> ("light" | "dark").
// System and any other value remove the attribute and the stored key.

export type GlassTheme = "light" | "dark" | "system";

export const GLASS_THEME_KEY = "projecta.settings.glassTheme";

export const GLASS_THEME_OPTIONS: readonly { value: GlassTheme; label: string }[] = [
  { value: "light", label: de["theme.light"] }, { value: "dark", label: de["theme.dark"] },
  { value: "system", label: de["theme.system"] },
];

/** Light and dark are painted and stored. System and any other value clear both. */
function persistedGlassTheme(theme: string): "light" | "dark" | null {
  return theme === "light" || theme === "dark" ? theme : null;
}

export function loadGlassTheme(): GlassTheme {
  const raw = readString(GLASS_THEME_KEY);
  return persistedGlassTheme(raw ?? "") ?? "system";
}

export function applyGlassTheme(theme: GlassTheme): void {
  const persisted = persistedGlassTheme(theme);
  if (persisted === null) delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = persisted;
}

export function saveGlassTheme(theme: GlassTheme): void {
  writeString(GLASS_THEME_KEY, persistedGlassTheme(theme));
  applyGlassTheme(theme);
}

/** Call once before the first render (V2-F9: from `main.tsx`) to avoid a flash of the wrong theme. */
export function applyStoredGlassTheme(): void {
  applyGlassTheme(loadGlassTheme());
}
