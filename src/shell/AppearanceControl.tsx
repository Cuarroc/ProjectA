import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Segmented } from "../design/controls/Segmented";
import { GLASS_VARIANTS, useGlassVariant } from "../design/variants/useGlassVariant";
import { GLASS_THEME_OPTIONS, loadGlassTheme, saveGlassTheme, type GlassTheme } from "./theme";
import { MENU_LABEL, STYLE_LABEL, THEME_LABEL, VARIANT_LABELS } from "./texts";

const VARIANT_OPTIONS = GLASS_VARIANTS.map((value) => ({ value, label: VARIANT_LABELS[value] }));

/** Below this viewport width the two segmented groups no longer fit next to Not-Aus and collapse into one menu. */
export const COMPACT_QUERY = "(max-width: 1599px)";

/** Live match of a media query; without `matchMedia` (old webviews, tests) it never matches. */
function useMediaQuery(query: string): boolean {
  const mq = () => (typeof window.matchMedia === "function" ? window.matchMedia(query) : null);
  const subscribe = (notify: () => void) => {
    const list = mq();
    list?.addEventListener("change", notify);
    return () => list?.removeEventListener("change", notify);
  };
  return useSyncExternalStore(subscribe, () => mq()?.matches ?? false);
}

function Groups() {
  const [theme, setTheme] = useState<GlassTheme>(loadGlassTheme);
  const [variant, setVariant] = useGlassVariant();
  const change = (next: GlassTheme) => { setTheme(next); saveGlassTheme(next); };
  return (
    <>
      <Segmented aria-label={THEME_LABEL} options={GLASS_THEME_OPTIONS} value={theme} onChange={change} />
      <Segmented aria-label={STYLE_LABEL} options={VARIANT_OPTIONS} value={variant} onChange={setVariant} />
    </>
  );
}

/** One "Darstellung" button that opens the groups in a panel; Escape or a click outside closes it. */
function CompactMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  return (
    <div
      ref={root}
      className="g-app-menu"
      onKeyDown={(e) => { if (e.key === "Escape" && open) { setOpen(false); button.current?.focus(); } }}
    >
      <button ref={button} type="button" className="g-app-menu__btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        {MENU_LABEL}
      </button>
      {open ? <div className="g-app-menu__panel"><Groups /></div> : null}
    </div>
  );
}

/** Hell / Dunkel / System, then the glass style (Glas / Klar / Nebel / Abend); one menu button when space is short. */
export function AppearanceControl() {
  return useMediaQuery(COMPACT_QUERY) ? <CompactMenu /> : <Groups />;
}
