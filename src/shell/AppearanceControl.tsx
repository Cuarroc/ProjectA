import { useState } from "react";

import { Segmented } from "../design/controls/Segmented";
import { GLASS_THEME_OPTIONS, loadGlassTheme, saveGlassTheme, type GlassTheme } from "./theme";

/** Hell / Dunkel / System. Small on purpose: V2-TH-VAR-2 adds a "Stil" Segmented beside it. */
export function AppearanceControl() {
  const [theme, setTheme] = useState<GlassTheme>(loadGlassTheme);
  const change = (next: GlassTheme) => { setTheme(next); saveGlassTheme(next); };
  return <Segmented aria-label="Darstellung" options={GLASS_THEME_OPTIONS} value={theme} onChange={change} />;
}
