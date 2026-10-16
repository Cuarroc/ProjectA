// Local German UI words of the shell appearance control. V2-F6 (src/i18n/de.ts) is not on main yet:
// moving these into the dictionary later is mechanical (one key per entry).
import type { MotionMode } from "../design/motion/motionMode";
import type { GlassVariant } from "../design/variants/useGlassVariant";

/** Below this viewport width the two segmented groups collapse into one menu (not a UI word; lives here because the i18n scanner skips this file).
 *  Right under the 1440 px design width (decision D7): the header must not collapse there. The full controls fit from 1253 px;
 *  at 1440 the search field shows a shortened label and no shortcut chip (follow-up V2-FU-HEADER-SPACE). */
export const COMPACT_QUERY = "(max-width: 1439px)";
export const STYLE_LABEL = "Stil";
export const THEME_LABEL = "Farbschema";

export const VARIANT_LABELS: Record<GlassVariant, string> = {
  glas: "Glas", klar: "Klar", nebel: "Nebel", abend: "Abend",
};

export const MOTION_LABEL = "Bewegung";
export const MOTION_LABELS: Record<MotionMode, string> = { calm: "Ruhig", lively: "Lebendig", off: "Aus" };
export const MOTION_SYSTEM_HINT = "Dein System verlangt weniger Bewegung";
export const PICK_TEXT = {
  choose: "Projekt wählen",
  label: (action: string, name: string) => `${action}: ${name}`,
  loading: "Projekte werden geladen …",
  empty: "Noch kein Projekt – lege eins in den Einstellungen an",
  failed: "Projekte konnten nicht geladen werden.",
};
