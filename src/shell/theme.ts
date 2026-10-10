import { readString, writeString } from "../lib/settings";

// V2-F8a theme contract: only `data-theme` on <html> ("light" | "dark"; System removes it).

export type GlassTheme = "light" | "dark" | "system";

export const GLASS_THEME_KEY = "projecta.settings.glassTheme";

export const GLASS_THEME_OPTIONS: readonly { value: GlassTheme; label: string }[] = [
  { value: "light", label: "Hell" }, { value: "dark", label: "Dunkel" }, { value: "system", label: "System" },
];

export function loadGlassTheme(): GlassTheme {
  const raw = readString(GLASS_THEME_KEY);
  return raw === "light" || raw === "dark" ? raw : "system";
}

export function applyGlassTheme(theme: GlassTheme): void {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

export function saveGlassTheme(theme: GlassTheme): void {
  writeString(GLASS_THEME_KEY, theme === "system" ? null : theme);
  applyGlassTheme(theme);
}

/** Call once before the first render (V2-F9: from `main.tsx`) to avoid a flash of the wrong theme. */
export function applyStoredGlassTheme(): void {
  applyGlassTheme(loadGlassTheme());
}
