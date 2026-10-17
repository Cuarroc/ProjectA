import { useEffect, useState, type ReactNode } from "react";

import { de, type MessageKey } from "../../i18n/de";
import { Button } from "../controls/Button";
import { Icon } from "../icons/Icon";
import { GLYPHS } from "../icons/glyphs";
import { motionDuration } from "../motion/tokens";
import { useMotion } from "../motion/motionMode";
import { COMPONENT_REGISTRY, type ComponentFamily } from "../registry";
import "./gallery.css";

// DS-X-15 (D6): read-only gallery of the design tokens. No IPC, no store: every value comes from tokens.css.
const PAGES = ["colour", "type", "space", "radius", "glass", "motion"] as const;
type Page = (typeof PAGES)[number] | ComponentFamily;
const FAMILIES = [...new Set(COMPONENT_REGISTRY.map((entry) => entry.family))];

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
    case "icons": return (
      <ul className="g-gal-grid">{Object.keys(GLYPHS).map((n) => <li key={n} className="g-gal-icon"><Icon name={n as keyof typeof GLYPHS} /><code>{n}</code></li>)}</ul>
    );
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
  const [page, setPage] = useState<Page>("colour");
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
