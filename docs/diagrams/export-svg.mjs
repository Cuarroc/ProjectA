// Turns an Archify HTML diagram into the static, self-contained README SVG.
//
//   node docs/diagrams/export-svg.mjs export <in.html> <out.svg> <light|dark> "<title>" "<desc>"
//   node docs/diagrams/export-svg.mjs contrast <file.svg>...
//
// `export` opens the HTML in Chromium, swaps the Archify palette for the
// ProjectA design tokens (src/design/tokens.css), inlines every computed
// paint, drops the viewer layer (hit targets, flow overlays, grid, scripts,
// styles) and crops to the drawing. `contrast` prints the WCAG ratio of every
// text colour against what is really painted behind it.
// Chromium comes from `ARCHIFY_CHROME`, else from Playwright; set
// `ARCHIFY_NO_SANDBOX=1` where the browser sandbox is unavailable.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright-core');
const [, , mode, ...args] = process.argv;

// Light and dark token values: ground, ink, muted, faint, accent and the status
// pairs [strong, soft] that stand for the Archify node types.
const TOKENS = {
  light: { ground: '#E9EDF3', ink: '#121826', muted: '#4E5868', faint: '#636C7D', accent: '#1F57D6', mask: '#F9FAFC', line: '#C7CCD5',
    t: { frontend: ['#08679E', '#DDEEF8'], backend: ['#1F57D6', '#E3EAF8'], database: ['#6431B6', '#EDE4FA'],
      cloud: ['#A54800', '#FCE8D3'], security: ['#B51D25', '#FBE1E1'], messagebus: ['#11703A', '#DBF0E3'], external: ['#525B69', '#E7EAEF'] } },
  dark: { ground: '#0D1219', ink: '#E8ECF2', muted: '#A2ACBB', faint: '#8D97A7', accent: '#6E9BFF', mask: '#181E29', line: '#2E3541',
    t: { frontend: ['#66C5F2', '#233545'], backend: ['#6E9BFF', '#222F4A'], database: ['#C0A6FF', '#2F2A47'],
      cloud: ['#FFB16A', '#3A2C25'], security: ['#FF8388', '#3C2830'], messagebus: ['#66D392', '#1F3A35'], external: ['#A2ACBB', '#2A313C'] } },
};
const FONT_SANS = "Geist, Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const FONT_MONO = "'Geist Mono', 'Cascadia Mono', Consolas, monospace";

const launch = () => chromium.launch({
  executablePath: process.env.ARCHIFY_CHROME || undefined,
  args: process.env.ARCHIFY_NO_SANDBOX ? ['--no-sandbox'] : [],
});

async function exportSvg(inHtml, outSvg, theme, title, desc) {
  const T = TOKENS[theme];
  const vars = { '--bg': T.ground, '--text': T.ink, '--text-muted': T.muted, '--text-dim': T.faint, '--text-faint': T.faint,
    '--lane-stroke': T.line, '--lane-fill': 'transparent', '--arrow': T.muted, '--arrow-emphasis': T.accent, '--mask': T.mask, '--grid': 'transparent' };
  for (const [k, [strong, soft]] of Object.entries(T.t)) { vars[`--${k}-stroke`] = strong; vars[`--${k}-fill`] = soft; }
  const css = `html[data-theme="${theme}"]{${Object.entries(vars).map(([k, v]) => `${k}:${v} !important`).join(';')}}
*{animation:none !important;transition:none !important}
${Object.keys(T.t).map((k) => `svg [data-node-id] > rect:not(.c-mask).c-${k}{fill:var(--${k}-fill) !important;stroke:var(--${k}-stroke) !important}`).join('\n')}`;
  const browser = await launch();
  let svg;
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await page.goto(pathToFileURL(resolve(inHtml)).href);
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await page.addStyleTag({ content: css });
    svg = await page.evaluate(([T, FONT_SANS, FONT_MONO, title, desc]) => {
      const live = document.querySelector('svg[data-quality-profile]');
      const clone = live.cloneNode(true);
      const lt = [live, ...live.querySelectorAll('*')], ct = [clone, ...clone.querySelectorAll('*')];
      const cv = document.createElement('canvas').getContext('2d');
      const hex = (c) => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = cv.getImageData(0, 0, 1, 1).data;
        return ['#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase(), a / 255]; };
      const paint = (prop, v, out) => {
        if (v === 'none' || v.startsWith('url(')) { out.push(`${prop}:${v}`); return; }
        const [h, a] = hex(v); out.push(`${prop}:${h}`); if (a < 1) out.push(`${prop}-opacity:${+a.toFixed(3)}`);
      };
      const drop = [];
      lt.forEach((el, i) => {
        const c = ct[i], cs = getComputedStyle(el), tag = el.tagName.toLowerCase(), cl = el.classList;
        if (['style', 'script', 'foreignobject'].includes(tag) || cs.display === 'none' || cl.contains('ambient-edge-flow') ||
            cl.contains('relationship-hit-overlay') || cl.contains('relationship-focus-rail') ||
            (tag === 'desc' && el !== live.querySelector('desc')) || cs.fill.includes('grid')) { drop.push(c); return; }
        const out = [];
        if (cl.contains('c-region')) out.push(`fill:${T.accent}`, 'fill-opacity:0.06', `stroke:${T.accent}`, 'stroke-opacity:0.45', 'stroke-width:1', 'stroke-dasharray:8 4');
        else if (['rect', 'path', 'circle', 'line', 'polygon', 'polyline', 'ellipse', 'text', 'tspan'].includes(tag)) {
          paint('fill', cs.fill, out);
          if (tag === 'text' || tag === 'tspan') {
            const mono = /mono|jetbrains|consolas|courier/i.test(cs.fontFamily);
            out.push(`font-family:${mono ? FONT_MONO : FONT_SANS}`, `font-size:${cs.fontSize}`, `font-weight:${cs.fontWeight}`, `text-anchor:${cs.textAnchor}`);
            if (cs.letterSpacing !== 'normal') out.push(`letter-spacing:${cs.letterSpacing}`);
            if (cs.dominantBaseline !== 'auto') out.push(`dominant-baseline:${cs.dominantBaseline}`);
          } else {
            paint('stroke', cs.stroke, out);
            if (cs.stroke !== 'none') {
              out.push(`stroke-width:${parseFloat(cs.strokeWidth)}`, `stroke-linecap:${cs.strokeLinecap}`, `stroke-linejoin:${cs.strokeLinejoin}`);
              if (cs.strokeDasharray !== 'none') out.push(`stroke-dasharray:${cs.strokeDasharray.replace(/px/g, '')}`);
            }
          }
        }
        // The frame label follows the frame (accent), not the Archify "cloud" colour.
        if (el.getAttribute('data-graph-role') === 'structural-frame-label-mask') out.splice(0, out.length, `fill:${T.mask}`, `stroke:${T.accent}`, 'stroke-opacity:0.45', 'stroke-width:0.8');
        if (tag === 'text' && el.closest('[data-graph-role="structural-frame-label"]')) out[0] = `fill:${T.accent}`;
        if (cs.opacity === '0') { drop.push(c); return; }
        if (cs.opacity !== '1') out.push(`opacity:${cs.opacity}`);
        // Styling moves into one style attribute; markup, geometry and ids stay.
        if (tag !== 'svg') for (const a of [...c.attributes]) if (/^(class|style|data-.*|pointer-events|tabindex|role|aria-.*|focusable|stroke.*|fill.*|font-.*|text-anchor|opacity)$/.test(a.name)) c.removeAttribute(a.name);
        if (out.length) c.setAttribute('style', out.join(';'));
      });
      drop.forEach((d) => d.remove());
      clone.querySelectorAll('pattern, rect[width="100%"]').forEach((p) => p.remove());
      // Invisible hit paths (stroke-opacity 0) belong to the viewer, not the picture.
      clone.querySelectorAll('[style*="stroke-opacity:0;"]').forEach((p) => p.remove());
      for (const a of [...clone.attributes]) if (a.name !== 'viewBox') clone.removeAttribute(a.name);
      // Crop to the drawing: the viewer reserves room for its own chrome.
      const holder = document.createElement('div'); holder.style.cssText = 'position:absolute;left:-9999px;top:0';
      holder.appendChild(clone); document.body.appendChild(holder);
      const bb = clone.getBBox(), M = 28;
      const x0 = Math.floor(bb.x - M), y0 = Math.floor(bb.y - M), w = Math.ceil(bb.width + 2 * M), h = Math.ceil(bb.height + 2 * M);
      holder.remove();
      clone.setAttribute('viewBox', `${x0} ${y0} ${w} ${h}`);
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('role', 'img'); clone.setAttribute('lang', 'de');
      clone.setAttribute('width', w); clone.setAttribute('height', h); clone.setAttribute('aria-labelledby', 't d');
      clone.querySelectorAll(':scope > title, :scope > desc').forEach((n) => n.remove());
      const NS = 'http://www.w3.org/2000/svg';
      const mk = (n, id, tx) => { const e = document.createElementNS(NS, n); e.id = id; e.textContent = tx; return e; };
      const bg = document.createElementNS(NS, 'rect');
      for (const [k, v] of Object.entries({ x: x0, y: y0, width: w, height: h, rx: 20, fill: T.ground })) bg.setAttribute(k, v);
      clone.prepend(bg); clone.prepend(mk('desc', 'd', desc)); clone.prepend(mk('title', 't', title));
      return new XMLSerializer().serializeToString(clone);
    }, [T, FONT_SANS, FONT_MONO, title, desc]);
  } finally {
    await browser.close();
  }
  // Drop indentation between tags, but whitespace touching a tspan is text: one space.
  const out = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+<(?!\/?tspan\b)/g, '><').replace(/>\s+</g, '> <');
  writeFileSync(outSvg, out);
  console.log(`${outSvg}: ${Buffer.byteLength(out)} bytes, <script>: ${(out.match(/<script/g) || []).length}`);
}

async function contrast(files) {
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 2000, height: 1400 } });
    for (const f of files) {
      await page.setContent(`<body style="margin:0">${readFileSync(f, 'utf8')}</body>`);
      const rows = await page.evaluate(() => {
        const cv = document.createElement('canvas').getContext('2d');
        const rgba = (c) => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
        const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const res = new Map();
        for (const t of document.querySelectorAll('svg text')) {
          const r = t.getBoundingClientRect(); if (!r.width) continue;
          const layers = document.elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2).filter((e) => e !== t && e.closest('svg') && e.tagName !== 'svg' && !/^(text|tspan|title|desc|g)$/i.test(e.tagName)).reverse();
          let bg = [255, 255, 255];
          for (const e of layers) { const cs = getComputedStyle(e); if (cs.fill === 'none') continue; const [R, G, B, A] = rgba(cs.fill); const a = A * parseFloat(cs.fillOpacity); bg = [R * a + bg[0] * (1 - a), G * a + bg[1] * (1 - a), B * a + bg[2] * (1 - a)]; }
          const [fr, fg, fb] = rgba(getComputedStyle(t).fill);
          const l1 = lum([fr, fg, fb]), l2 = lum(bg), ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          const hx = (v) => '#' + v.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('').toUpperCase();
          const key = `${hx([fr, fg, fb])} on ${hx(bg)}`;
          if (!res.has(key) || res.get(key).ratio > ratio) res.set(key, { ratio, sample: t.textContent.slice(0, 24) });
        }
        return [...res].map(([k, v]) => [k, v.ratio, v.sample]);
      });
      const min = Math.min(...rows.map((r) => r[1]));
      console.log(`${f}: ${rows.length} colour pairs, minimum ${min.toFixed(2)}:1 ${min >= 4.5 ? 'OK' : 'FAIL'}`);
      for (const [k, ratio, sample] of rows.sort((a, b) => a[1] - b[1])) console.log(`  ${ratio.toFixed(2)}:1  ${k}  ("${sample}")`);
      if (min < 4.5) process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

if (mode === 'export') await exportSvg(...args);
else if (mode === 'contrast') await contrast(args);
else { console.error('usage: export-svg.mjs export <in.html> <out.svg> <light|dark> <title> <desc> | contrast <file.svg>...'); process.exit(2); }
