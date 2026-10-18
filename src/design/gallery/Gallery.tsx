import { useEffect, useState, type ReactNode } from "react";

import { de, type MessageKey } from "../../i18n/de";
import { Button } from "../controls/Button";
import { Segmented } from "../controls/Segmented";
import { Hall } from "../hall/Hall";
import { EMPTY_HALL, SAMPLE_HALL, type HallScene } from "../hall/fixtures";
import { motionDuration } from "../motion/tokens";
import { MOTION_MODES, useMotion, type MotionMode } from "../motion/motionMode";
import { COMPONENT_REGISTRY, type ComponentFamily } from "../registry";
import "./gallery.css";

// DS-X-15 (D6): read-only gallery of the design tokens. No IPC, no store: every value comes from tokens.css.
// DS-H-07a: the page "Probe-Halle" (family hall) renders Hall on Beispieldaten. Its switches override the hall only.
// The route is hash based, so the state sits in the hash query and is read once when the gallery opens:
//   #/designsystem?page=hall&motion=calm|lively|off&set=normal|empty|unread
// `page` is any page id below (colour, type, space, radius, glass, motion or a family such as hall); unknown values fall back.
const PAGES = ["colour", "type", "space", "radius", "glass", "motion"] as const;
type Page = (typeof PAGES)[number] | ComponentFamily;
const FAMILIES = [...new Set(COMPONENT_REGISTRY.map((entry) => entry.family))];

/** The sample sets of the probe hall; `unread` is no scene at all. */
const HALL_SETS: Record<"normal" | "empty" | "unread", HallScene | undefined> = { normal: SAMPLE_HALL, empty: EMPTY_HALL, unread: undefined };
type HallSet = keyof typeof HALL_SETS;
const HALL_SET_IDS = Object.keys(HALL_SETS) as HallSet[];

/** The first of `ids` that equals `raw`, else the first id. */
const oneOf = <T extends string>(ids: readonly T[], raw: string | null): T => ids.find((id) => id === raw) ?? ids[0];
const query = () => new URLSearchParams(window.location.hash.split("?")[1] ?? "");

const SWATCHES = ["--g-ink", "--g-ink2", "--g-muted", "--g-accent", "--g-run", "--g-need", "--g-rev", "--g-ok", "--g-bad"];
const TYPE = ["display", "title", "heading", "subheading", "body", "label", "note", "micro", "code"];
const RADIUS = ["xs", "sm", "md", "lg", "ctl", "card", "panel", "sheet", "pill"];

/** WCAG 2.1 relative luminance of a `#rrggbb` value; NaN for anything else. */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return NaN;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(fg: string, bg: string): string {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  const value = (hi + 0.05) / (lo + 0.05);
  return Number.isNaN(value) ? de["gallery.ratioUnknown"] : `${value.toFixed(1).replace(".", ",")}:1`;
}

/** Re-render when the theme or glass style on <html> changes, so the ratios follow the active tokens. */
function useRootAttributes(): void {
  const [, bump] = useState(0);
  useEffect(() => {
    const watch = new MutationObserver(() => bump((n) => n + 1));
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-glass-variant"] });
    return () => watch.disconnect();
  }, []);
}

function Colours() {
  useRootAttributes();
  const root = getComputedStyle(document.documentElement);
  const ground = root.getPropertyValue("--g-ground");
  return (
    <>
      <p className="g-gal-note">{de["gallery.contrastHint"]}</p>
      <ul className="g-gal-grid" aria-label={de["gallery.colour"]}>
        {SWATCHES.map((token) => (
          <li key={token} className="g-gal-swatch">
            <span className="g-gal-chip" style={{ background: `var(${token})` }} />
            <code>{token}</code>
            <strong>{ratio(root.getPropertyValue(token), ground)}</strong>
          </li>
        ))}
      </ul>
    </>
  );
}

function MotionDemo() {
  const { reduced } = useMotion();
  const [moved, setMoved] = useState(false);
  return (
    <>
      <div className="g-gal-track"><span className="g-gal-dot" data-moved={moved && !reduced ? "on" : "off"} /></div>
      <Button size="sm" disabled={reduced} onClick={() => setMoved((m) => !m)}>{de["gallery.play"]}</Button>
      {reduced ? <p className="g-gal-note">{de["gallery.motionRests"]}</p> : null}
      <ul className="g-gal-list">{Object.values(motionDuration).map((token) => <li key={token}><code>{token}</code></li>)}</ul>
    </>
  );
}

function ProbeHall() {
  const [motion, onMotion] = useState<MotionMode>(() => oneOf(MOTION_MODES, query().get("motion")));
  const [set, onSet] = useState<HallSet>(() => oneOf(HALL_SET_IDS, query().get("set")));
  return (
    <>
      <div className="g-gal-row">
        <Segmented aria-label={de["gallery.hall.motion"]} value={motion} onChange={onMotion} options={MOTION_MODES.map((value) => ({ value, label: de[`gallery.hall.mode.${value}`] }))} />
        <Segmented aria-label={de["gallery.hall.set"]} value={set} onChange={onSet} options={HALL_SET_IDS.map((value) => ({ value, label: de[`gallery.hall.set.${value}`] }))} />
      </div>
      <Hall scene={HALL_SETS[set]} motion={motion} />
    </>
  );
}

const Sample = ({ children }: { children: ReactNode }) => <><p className="g-gal-sample">{de["gallery.sample"]}</p>{children}</>;

function Body({ page }: { page: Page }) {
  switch (page) {
    case "colour": return <Colours />;
    case "type": return (
      <Sample>{TYPE.map((role) => (
        <p key={role} className="g-gal-row"><code>--g-t-{role}</code><span style={{ font: `var(--g-t-${role})` }}>{de["gallery.sampleText"]}</span></p>
      ))}</Sample>
    );
    case "space": return (
      <ul className="g-gal-list">{Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <li key={n} className="g-gal-row"><code>--g-space-{n}</code><span className="g-gal-bar" style={{ width: `var(--g-space-${n})` }} /></li>
      ))}</ul>
    );
    case "radius": return (
      <ul className="g-gal-grid">{RADIUS.map((r) => (
        <li key={r} className="g-gal-swatch"><span className="g-gal-box" style={{ borderRadius: `var(--g-r-${r})` }} /><code>--g-r-{r}</code></li>
      ))}</ul>
    );
    case "glass": return (
      <Sample>
        <div className="g-gal-grid">
          <div className="g-chrome g-gal-pane"><code>.g-chrome</code><div className="g-glass g-gal-pane"><code>.g-glass</code></div></div>
          <div className="g-glass g-gal-pane"><code>.g-glass</code><div className="g-glass g-gal-pane"><code>.g-glass .g-glass</code></div></div>
        </div>
      </Sample>
    );
    case "motion": return <MotionDemo />;
    case "hall": return <ProbeHall />;
    default: return (
      <>
        <p className="g-gal-note">{de["gallery.storiesLater"]}</p>
        <ul className="g-gal-list">{COMPONENT_REGISTRY.filter((e) => e.family === page).map((e) => <li key={e.name}><code>{e.name}</code></li>)}</ul>
      </>
    );
  }
}

const label = (page: Page): string =>
  (PAGES as readonly string[]).includes(page) ? de[`gallery.${page}` as MessageKey] : de[`gallery.family.${page}` as MessageKey];

export function Gallery() {
  const [page, setPage] = useState<Page>(() => oneOf<Page>(["colour", ...PAGES, ...FAMILIES], query().get("page")));
  const link = (p: Page) => (
    <li key={p}><Button size="sm" variant={p === page ? "tint" : "ghost"} aria-current={p === page ? "page" : undefined} onClick={() => setPage(p)}>{label(p)}</Button></li>
  );
  return (
    <div className="g-gal">
      <header className="g-gal-head">
        <h1>{de["gallery.title"]}</h1>
        <p className="g-gal-note">{de["gallery.hint"]}</p>
      </header>
      <div className="g-gal-body">
        <nav className="g-gal-nav g-glass" aria-label={de["gallery.nav"]}>
          <h2>{de["gallery.foundations"]}</h2>
          <ul>{PAGES.map(link)}</ul>
          <h2>{de["gallery.components"]}</h2>
          <ul>{FAMILIES.map(link)}</ul>
        </nav>
        <section className="g-gal-page g-glass" aria-label={label(page)}>
          <h2>{label(page)}</h2>
          <Body page={page} />
        </section>
      </div>
    </div>
  );
}
