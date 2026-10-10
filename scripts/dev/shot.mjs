#!/usr/bin/env node
// V2-F7 — route screenshots (1440×900 light/dark) and optional tab-order check.
// Uses Playwright from devDependencies. --fixture serves a local HTML for tests.
import { createServer } from "node:http";
import { readFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve, extname } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { EXIT, UsageError, isMain, runCli, withExitCodes } from "../lib/dev-tools.mjs";

export const VIEWPORT = Object.freeze({ width: 1440, height: 900 });

// V2-TH-VAR-2: glass style preference (mirror of src/design/variants/useGlassVariant.ts).
export const VARIANTS = Object.freeze(["glas", "klar", "nebel", "abend"]);
export const VARIANT_KEY = "projecta.settings.glassVariant";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/** Read width/height from a PNG buffer (IHDR). */
export function pngSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24 || buf[0] !== 0x89 || buf.toString("ascii", 1, 4) !== "PNG") {
    throw new Error("not a PNG");
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export function routeSlug(route) {
  const s = String(route || "/").replace(/^\//, "").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "root";
}

function serveFile(filePath) {
  const root = dirname(resolve(filePath));
  const indexName = filePath.slice(root.length + 1) || "index.html";
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    const rel = urlPath === "/" ? indexName : urlPath.replace(/^\//, "");
    const target = resolve(root, rel);
    if (!target.startsWith(root) || !existsSync(target) || !statSync(target).isFile()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[extname(target)] || "application/octet-stream" });
    res.end(readFileSync(target));
  });
  return new Promise((resolveListen) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolveListen({
        origin: `http://127.0.0.1:${port}`,
        close: () => new Promise((r, j) => server.close((e) => (e ? j(e) : r()))),
      });
    });
  });
}

async function checkTab(page) {
  // Identity keys via data-pa-shot-id; one stop per radio name; stop after a cycle.
  const expected = await page.evaluate(() => {
    const vis = (el) => {
      const s = getComputedStyle(el);
      return s.visibility !== "hidden" && s.display !== "none" && el.getClientRects().length > 0;
    };
    for (const el of document.querySelectorAll("[data-pa-shot-id]")) el.removeAttribute("data-pa-shot-id");
    const sel = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const groups = new Set();
    let n = 0, stops = 0;
    for (const el of [...document.querySelectorAll(sel)].filter(vis)) {
      const id = String(++n);
      el.setAttribute("data-pa-shot-id", id);
      if (el instanceof HTMLInputElement && el.type === "radio") {
        const g = el.name || `anon-${id}`;
        if (groups.has(g)) continue;
        groups.add(g);
      }
      stops++;
    }
    return stops;
  });
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  const seen = new Set(), missing = new Set();
  for (let i = 0; i < Math.max(expected + 2, 2); i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return null;
      const s = getComputedStyle(el);
      const outline = Number.parseFloat(s.outlineWidth) > 0 && s.outlineStyle !== "none";
      const id = el.getAttribute("data-pa-shot-id");
      if (!id) return null;
      const key = el instanceof HTMLInputElement && el.type === "radio" ? `radio:${el.name || id}` : id;
      return { key, outline };
    });
    if (!info) continue;
    if (seen.has(info.key)) break;
    seen.add(info.key);
    if (!info.outline) missing.add(info.key);
  }
  const missingFocusRing = missing.size;
  return { ok: seen.size >= expected && missingFocusRing === 0, visited: seen.size, expected, missingFocusRing };
}

/** Capture light+dark shots (and optional tab check) for one route.
 *  `path` is the URL path to open (defaults to `route`). Fixture mode opens `/`
 *  and keeps `route` only for the PNG slug. With `variant`, `applied` reports the
 *  glass style found on <html> per scheme ({ light, dark }). */
export async function captureRoute({ base, route, path, outDir, checkTabOrder = false, variant = null }) {
  mkdirSync(outDir, { recursive: true });
  const slug = variant ? `${routeSlug(route)}-${variant}` : routeSlug(route);
  const openPath = path ?? route;
  const url = new URL(openPath.startsWith("http") ? openPath : openPath, base.endsWith("/") ? base : `${base}/`).href;
  const browser = await chromium.launch({ headless: true });
  const files = [];
  let tab = null;
  const applied = {};
  try {
    for (const scheme of ["light", "dark"]) {
      const page = await browser.newPage({
        viewport: { ...VIEWPORT },
        colorScheme: scheme,
        reducedMotion: "reduce",
      });
      // The stored preference must be in place before the app's first script runs.
      if (variant) {
        await page.addInitScript(([key, id]) => {
          if (id === "glas") localStorage.removeItem(key);
          else localStorage.setItem(key, id);
        }, [VARIANT_KEY, variant]);
      }
      await page.goto(url, { waitUntil: "networkidle" });
      if (variant) applied[scheme] = await page.evaluate(() => document.documentElement.dataset.glassVariant ?? "glas");
      if (checkTabOrder && scheme === "light") tab = await checkTab(page);
      const dest = join(outDir, `${slug}-${scheme}.png`);
      await page.screenshot({ path: dest, fullPage: false });
      files.push(dest);
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return { route, files, tab, viewport: VIEWPORT, ...(variant ? { variant, applied } : {}) };
}

const HELP = `shot — V2-F7 screenshots (1440×900 light/dark) and optional tab check

Usage:
  node scripts/dev/shot.mjs --route <path> [--base <url>] [--out <dir>] [--fixture <html>] [--check-tab] [--variant <id>]

  --route      App path (also names the PNG files), e.g. / or /settings
  --base       Running origin (default http://127.0.0.1:1420)
  --fixture    Local HTML file served instead of --base (tests / offline)
  --out        Output directory (default ./shots)
  --variant    Glass style stored before load: glas, klar, nebel or abend (PNGs get -<id> in the name)
  --check-tab  Fail unless every focusable control is reached with a visible focus ring

Exit: 0 ok, 1 capture/tab failure, 2 bad arguments.
`;

export const main = withExitCodes(async (argv, io) => {
  const { values } = parseArgs({
    args: argv,
    options: {
      route: { type: "string" },
      base: { type: "string" },
      out: { type: "string" },
      fixture: { type: "string" },
      "check-tab": { type: "boolean" },
      variant: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) return io.out(HELP), EXIT.OK;
  if (!values.route) throw new UsageError("--route is required");
  if (values.variant !== undefined && !VARIANTS.includes(values.variant)) {
    throw new UsageError(`--variant must be one of ${VARIANTS.join(", ")}`);
  }
  const outDir = resolve(values.out || "shots");
  let base = values.base || "http://127.0.0.1:1420";
  let closer = null;
  if (values.fixture) {
    const fixture = resolve(values.fixture);
    if (!existsSync(fixture)) throw new UsageError(`fixture not found: ${fixture}`);
    const srv = await serveFile(fixture);
    base = srv.origin;
    closer = srv.close;
  }
  try {
    const checkTabOrder = Boolean(values["check-tab"]);
    const report = await captureRoute({
      base,
      route: values.route,
      // Fixture HTML is always at "/"; --route only names the output files.
      path: values.fixture ? "/" : values.route,
      outDir,
      checkTabOrder,
      variant: values.variant ?? null,
    });
    io.out(JSON.stringify(report, null, 2) + "\n");
    if (checkTabOrder && (!report.tab || !report.tab.ok)) {
      io.err(
        `tab check failed: visited=${report.tab?.visited ?? 0}/${report.tab?.expected ?? "?"} missingFocusRing=${report.tab?.missingFocusRing ?? "?"}\n`,
      );
      return EXIT.FAIL;
    }
    return EXIT.OK;
  } finally {
    if (closer) await closer();
  }
});

if (isMain(import.meta.url)) runCli(main);
