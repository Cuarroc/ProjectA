// Local German UI words of the shell appearance control. V2-F6 (src/i18n/de.ts) is not on main yet:
// moving these into the dictionary later is mechanical (one key per entry).
import type { GlassVariant } from "../design/variants/useGlassVariant";

export const STYLE_LABEL = "Stil";
export const THEME_LABEL = "Farbschema";
export const MENU_LABEL = "Darstellung";

export const VARIANT_LABELS: Record<GlassVariant, string> = {
  glas: "Glas", klar: "Klar", nebel: "Nebel", abend: "Abend",
};
