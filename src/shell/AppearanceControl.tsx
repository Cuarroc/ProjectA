import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { Segmented } from "../design/controls/Segmented";
import { MOTION_MODES, saveMotionMode, useMotion } from "../design/motion/motionMode";
import { useT } from "../i18n/useT";
import { GLASS_VARIANTS, useGlassVariant } from "../design/variants/useGlassVariant";
import { GLASS_THEME_OPTIONS, loadGlassTheme, saveGlassTheme, type GlassTheme } from "./theme";
import { COMPACT_QUERY, MOTION_LABEL, MOTION_LABELS, MOTION_SYSTEM_HINT, STYLE_LABEL, THEME_LABEL, VARIANT_LABELS } from "./texts";

const VARIANT_OPTIONS = GLASS_VARIANTS.map((value) => ({ value, label: VARIANT_LABELS[value] }));
const MOTION_OPTIONS = MOTION_MODES.map((value) => ({ value, label: MOTION_LABELS[value] }));

/** Live match of a media query; without `matchMedia` (old webviews, tests) it never matches. One list per query, released on unmount. */
function useMediaQuery(query: string): boolean {
  const list = useMemo(() => (typeof window.matchMedia === "function" ? window.matchMedia(query) : null), [query]);
  const subscribe = useCallback((notify: () => void) => {
    list?.addEventListener("change", notify);
    return () => list?.removeEventListener("change", notify);
  }, [list]);
  const getSnapshot = useCallback(() => list?.matches ?? false, [list]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

function MotionGroup() {
  const { mode, system } = useMotion();
  return (
    <>
      <Segmented aria-label={MOTION_LABEL} options={MOTION_OPTIONS} value={mode} onChange={saveMotionMode} />
      {system ? <small className="g-app-note">{MOTION_SYSTEM_HINT}</small> : null}
    </>
  );
}

function Groups({ motion }: { motion: boolean }) {
  const [theme, setTheme] = useState<GlassTheme>(loadGlassTheme);
  const [variant, setVariant] = useGlassVariant();
  const change = (next: GlassTheme) => { setTheme(next); saveGlassTheme(next); };
  return (
    <>
      <Segmented aria-label={THEME_LABEL} options={GLASS_THEME_OPTIONS} value={theme} onChange={change} />
      <Segmented aria-label={STYLE_LABEL} options={VARIANT_OPTIONS} value={variant} onChange={setVariant} />
      {motion ? <MotionGroup /> : null}
    </>
  );
}

/** One "Darstellung" button that opens the groups in a panel; Escape or a click outside closes it. */
function CompactMenu({ motion }: { motion: boolean }) {
  const t = useT();
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
      onBlur={(e) => { if (open && !root.current?.contains(e.relatedTarget)) setOpen(false); }}
    >
      <button ref={button} type="button" className="g-app-menu__btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        {t("shell.appearance")}
      </button>
      {open ? <div className="g-app-menu__panel"><Groups motion={motion} /></div> : null}
    </div>
  );
}

/** Hell / Dunkel / System, the glass style (Glas / Klar / Nebel / Abend), then the motion (Ruhig / Lebendig / Aus); one menu button when space is short.
 *  The header passes `motion={false}`: a third group costs the search its label (measured 1600-1800 px); the motion group lives in Einstellungen. */
export function AppearanceControl({ motion = true }: { motion?: boolean }) {
  return useMediaQuery(COMPACT_QUERY) ? <CompactMenu motion={motion} /> : <Groups motion={motion} />;
}
