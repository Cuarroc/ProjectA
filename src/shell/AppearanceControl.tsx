import { useState } from "react";

import { Segmented } from "../design/controls/Segmented";
import { GLASS_VARIANTS, useGlassVariant } from "../design/variants/useGlassVariant";
import { GLASS_THEME_OPTIONS, loadGlassTheme, saveGlassTheme, type GlassTheme } from "./theme";
import { STYLE_LABEL, VARIANT_LABELS } from "./texts";

const VARIANT_OPTIONS = GLASS_VARIANTS.map((value) => ({ value, label: VARIANT_LABELS[value] }));

/** Hell / Dunkel / System, then the glass style (Glas / Klar / Nebel / Abend). */
export function AppearanceControl() {
  const [theme, setTheme] = useState<GlassTheme>(loadGlassTheme);
  const [variant, setVariant] = useGlassVariant();
  const change = (next: GlassTheme) => { setTheme(next); saveGlassTheme(next); };
  return (
    <>
      <Segmented aria-label="Darstellung" options={GLASS_THEME_OPTIONS} value={theme} onChange={change} />
      <Segmented aria-label={STYLE_LABEL} options={VARIANT_OPTIONS} value={variant} onChange={setVariant} />
    </>
  );
}
