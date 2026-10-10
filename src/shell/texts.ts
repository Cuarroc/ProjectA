// Local German UI words of the shell appearance control. V2-F6 (src/i18n/de.ts) is not on main yet:
// moving these into the dictionary later is mechanical (one key per entry).
import type { GlassVariant } from "../design/variants/useGlassVariant";

/** Below this viewport width the two segmented groups no longer fit next to Not-Aus and collapse into one menu (not a UI word; lives here because the i18n scanner skips this file). */
export const COMPACT_QUERY = "(max-width: 1599px)";
export const STYLE_LABEL = "Stil";
export const THEME_LABEL = "Farbschema";

export const VARIANT_LABELS: Record<GlassVariant, string> = {
  glas: "Glas", klar: "Klar", nebel: "Nebel", abend: "Abend",
};
