import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * V161-UI-F2 — pressed surfaces (UM-17), field/row transitions, APP-3 hit
 * areas for the UM-15 glyph classes. Scans the owned motion and APP-3 slices
 * and measures hit areas in Chromium (review R1000-A1).
 */
const css = readFileSync(resolve(__dirname, "styles.css"), "utf8").replace(/\r\n/g, "\n");

const motionStart = css.indexOf("/* ---- motion");
const focusStart = css.indexOf("\n:focus-visible {", motionStart);
const motion = css.slice(motionStart, focusStart === -1 ? undefined : focusStart);

const app3Start = css.indexOf("/* APP-3");
const app3End = css.indexOf("\n.goal-passthrough {", app3Start);
const app3 = css.slice(app3Start, app3End === -1 ? undefined : app3End);

const rootBlock = css.slice(0, css.indexOf("@media (prefers-color-scheme: light)"));
const lightBlock = css.slice(
  css.indexOf("@media (prefers-color-scheme: light)"),
  css.indexOf("\n}", css.indexOf(":root", css.indexOf("@media (prefers-color-scheme: light)"))),
);

/** Base class from a compound selector like `.tab:hover:not(.tab-active)`. */
function baseClass(selector: string): string | null {
  const trimmed = selector.trim().replace(/^\.app\s+/, "");
  const match = trimmed.match(/^\.([\w-]+)/);
  return match ? `.${match[1]}` : null;
}

function selectorList(block: string): string[] {
  return block
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

const UM15_CLASSES = [
  ".worker-action",
  ".panel-tab",
  ".rail-collapse",
  ".rail-title",
  ".status-item",
  ".status-provider-action",
  ".command-chat-expand",
  ".question-worker",
  ".digest-toggle",
] as const;

describe("V161-UI-F2 states", () => {
  it("every class in the shared hover list also has :active pressed surface", () => {
    const hoverRule = motion.match(
      /((?:\.[\w-:()>.\s]+,\s*)+\.[\w-:()>.\s]+)\s*\{([^}]*background:\s*var\(--color-hover\)[^}]*)\}/,
    );
    expect(hoverRule, "shared row/tab/segment :hover list missing").not.toBeNull();

    const hoverClasses = new Set(
      selectorList(hoverRule![1])
        .map(baseClass)
        .filter((value): value is string => Boolean(value)),
    );
    expect([...hoverClasses].length).toBeGreaterThanOrEqual(8);
    // Cards with chips keep border-only hover (R1000-A3); no wash under badges.
    expect(hoverClasses.has(".board-card"), ".board-card must not use the shared hover wash").toBe(
      false,
    );

    const activeRules = [
      ...motion.matchAll(
        /((?:\.[\w-:()>.\s]+,\s*)*\.[\w-:()>.\s]+)\s*\{([^}]*background:\s*var\(--color-pressed\)[^}]*)\}/g,
      ),
    ];
    expect(activeRules.length, "shared :active pressed surface missing").toBeGreaterThanOrEqual(1);

    const activeSelectors = activeRules.flatMap((rule) => selectorList(rule[1]));
    const activeClasses = new Set(
      activeSelectors.map(baseClass).filter((value): value is string => Boolean(value)),
    );

    for (const cls of hoverClasses) {
      expect(activeClasses.has(cls), `${cls} has :hover but no :active pressed surface`).toBe(true);
    }

    for (const required of [
      ".project-button",
      ".worker-row",
      ".rail-item",
      ".tab",
      ".segment",
      ".panel-tab",
      ".settings-tab",
      ".queue-row",
      ".question-option",
      ".tab-select",
      ".worker-open",
      ".board-card-main",
    ]) {
      expect(activeClasses.has(required), `${required} missing from :active pressed list`).toBe(true);
    }
    expect(activeClasses.has(".board-card"), ".board-card must not use the shared pressed wash").toBe(
      false,
    );
  });

  it("container :active skips when a child button is pressed", () => {
    const activeRules = [
      ...motion.matchAll(
        /((?:\.[\w-:()>.\s]+,\s*)*\.[\w-:()>.\s]+)\s*\{([^}]*background:\s*var\(--color-pressed\)[^}]*)\}/g,
      ),
    ];
    expect(activeRules.length).toBeGreaterThanOrEqual(1);
    const selectors = activeRules.flatMap((rule) => selectorList(rule[1]));
    for (const host of [".worker-row", ".tab"]) {
      const hit = selectors.find((s) => s.includes(host) && s.includes(":active"));
      expect(hit, `${host} :active selector missing`).toBeTruthy();
      expect(hit!, `${host} must ignore nested button presses`).toMatch(/:not\(:has\(button:active\)\)/);
    }
    for (const primary of [".tab-select", ".worker-open", ".board-card-main"]) {
      expect(
        selectors.some((s) => s.includes(primary) && s.includes(":active")),
        `${primary} must carry its own pressed wash`,
      ).toBe(true);
    }
  });

  it("pressed list excludes already-selected surfaces", () => {
    const activeRules = [
      ...motion.matchAll(
        /((?:\.[\w-:()>.\s]+,\s*)*\.[\w-:()>.\s]+)\s*\{([^}]*background:\s*var\(--color-pressed\)[^}]*)\}/g,
      ),
    ];
    const joined = activeRules.map((rule) => rule[1]).join("\n");
    expect(joined).toMatch(/\.tab:active:not\(\.tab-active\)/);
    expect(joined).toMatch(/\.segment:active:not\(\.segment-active\)/);
    expect(joined).toMatch(/\.panel-tab:active:not\(\.panel-tab-active\)/);
    expect(joined).toMatch(/\.worker-row:active:not\(\.worker-row-active\)/);
  });

  it("hover and pressed colour tokens are defined in both modes", () => {
    expect(rootBlock).toMatch(/--color-hover:\s*rgba\([^)]+\)/);
    expect(rootBlock).toMatch(/--color-pressed:\s*rgba\([^)]+\)/);
    expect(lightBlock).toMatch(/--color-hover:\s*rgba\([^)]+\)/);
    expect(lightBlock).toMatch(/--color-pressed:\s*rgba\([^)]+\)/);
  });

  it("surface and field transitions never touch layout properties", () => {
    const fieldGroup = [...motion.matchAll(/((?:\.[\w-]+,\s*)+\.[\w-]+)\s*\{\s*transition:\s*([^}]+)\}/g)].find(
      (match) => selectorList(match[1]).includes(".field"),
    );
    expect(fieldGroup, "transition list including .field missing").toBeTruthy();

    const selectors = selectorList(fieldGroup![1]);
    for (const required of [
      ".field",
      ".project-button",
      ".worker-row",
      ".rail-item",
      ".board-card",
      ".tab",
      ".segment",
      ".queue-row",
      ".project-row",
      ".queue-entry",
      ".usage-row",
    ]) {
      expect(selectors, `${required} missing from transition list`).toContain(required);
    }

    const props = fieldGroup![2]
      .split(",")
      .map((part) => part.trim().split(/\s+/)[0])
      .filter(Boolean);
    for (const prop of props) {
      expect(prop).toMatch(/^(background(?:-color)?|border-color|color|opacity|transform|box-shadow)$/);
    }
    expect(props).not.toContain("width");
    expect(props).not.toContain("height");
    expect(props).not.toContain("padding");
    expect(props).not.toContain("margin");
  });

  it("each UM-15 class reaches 24x24 through the APP-3 hit-area overlay", () => {
    const anchor = app3.match(/((?:\.[\w-]+,\s*)+\.[\w-]+)\s*\{\s*position:\s*relative;\s*\}/);
    expect(anchor, "APP-3 position:relative list missing").not.toBeNull();
    const anchored = selectorList(anchor![1]).map((s) => s.replace(/\s+/g, ""));

    const afterRules = [...app3.matchAll(/((?:\.[\w-]+::after,\s*)*\.[\w-]+::after)\s*\{([^}]*)\}/g)];
    expect(afterRules.length, "APP-3 ::after hit-area rules missing").toBeGreaterThanOrEqual(1);

    for (const cls of UM15_CLASSES) {
      expect(anchored, `${cls} not anchored`).toContain(cls);
      const rule = afterRules.find((m) =>
        selectorList(m[1]).some((s) => s.replace(/\s+/g, "") === `${cls}::after`),
      );
      expect(rule, `${cls} missing ::after overlay`).toBeTruthy();
      expect(rule![2]).toMatch(/content:\s*""/);
      expect(rule![2]).toMatch(/position:\s*absolute/);
      expect(rule![2]).toMatch(/inset:\s*-\d+px/);
    }
  });
});

describe("V161-UI-F2 measured hit areas", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  it("Chromium measures every UM-15 hit area at least 24x24", async () => {
    const page = await browser.newPage({ colorScheme: "dark" });
    const fixture = `<!DOCTYPE html>
<html><head><style>${css}
body { margin: 0; background: #111; color: #fff; font: 12px sans-serif; }
.app { min-height: 100vh; }
.probe-row { display: flex; flex-wrap: wrap; gap: 48px; padding: 48px; align-items: center; }
.status-bar { display: flex; align-items: center; gap: 14px; height: 24px; overflow: visible; }
</style></head>
<body><div class="app"><div class="probe-row">
  <button type="button" class="worker-action">Beenden</button>
  <button type="button" class="panel-tab">Lernen</button>
  <button type="button" class="rail-collapse">‹</button>
  <button type="button" class="rail-title">BOARD</button>
  <div class="status-bar">
    <span class="status-item">Sitzung abc</span>
    <button type="button" class="status-action status-provider-action">🔌</button>
  </div>
  <button type="button" class="command-chat-expand">⤢</button>
  <button type="button" class="question-worker">feature/x</button>
  <button type="button" class="digest-toggle">Tagesüberblick</button>
</div></div></body></html>`;
    await page.setContent(fixture, { waitUntil: "load" });

    const sizes = await page.evaluate((classes) => {
      const px = (value: string) => {
        const n = Number.parseFloat(value);
        return Number.isFinite(n) ? Math.abs(n) : 0;
      };
      return classes.map((cls) => {
        const el = document.querySelector(cls) as HTMLElement | null;
        if (!el) return { cls, ok: false, w: 0, h: 0, reason: "missing" };
        const box = el.getBoundingClientRect();
        const after = getComputedStyle(el, "::after");
        const hasAfter = Boolean(after.content && after.content !== "none" && after.position === "absolute");
        const w = box.width + px(after.left) + px(after.right);
        const h = box.height + px(after.top) + px(after.bottom);
        const cx = box.left + box.width / 2;
        const cy = box.top + box.height / 2;
        const hit = document.elementFromPoint(cx, cy);
        const centerOk = hit === el || (hit !== null && el.contains(hit));
        return {
          cls,
          ok: hasAfter && w >= 24 && h >= 24 && centerOk,
          w,
          h,
          reason: hasAfter ? (centerOk ? "inset" : "miss") : "box",
        };
      });
    }, [...UM15_CLASSES]);

    await page.close();

    for (const sample of sizes) {
      expect(sample.ok, `${sample.cls} hit ${sample.w.toFixed(1)}x${sample.h.toFixed(1)} (${sample.reason})`).toBe(
        true,
      );
    }
  }, 60_000);

  it("pressing a nested button does not wash the host container", async () => {
    const page = await browser.newPage({ colorScheme: "dark" });
    await page.setContent(
      `<!DOCTYPE html><html><head><style>${css}
body{margin:0;background:#1c1c1e}
.app{padding:40px}
.tab{display:flex;height:28px;background:transparent}
.tab-select{flex:1;background:transparent;border:0;color:#fff;padding:4px 8px}
.tab-close{width:18px;height:18px;border:0;background:transparent;color:#fff}
.worker-row{display:flex;background:transparent}
.worker-open{flex:1;background:transparent;border:0;color:#fff;text-align:left;padding:6px 8px}
.worker-action{border:0;background:transparent;color:#fff;padding:3px 6px}
</style></head><body><div class="app">
  <div class="tab"><button type="button" class="tab-select">Tab</button><button type="button" class="tab-close">×</button></div>
  <div class="worker-row"><button type="button" class="worker-open">Task</button><button type="button" class="worker-action">Beenden</button></div>
</div></body></html>`,
      { waitUntil: "load" },
    );

    const tokens = await page.evaluate(() => {
      const probe = document.createElement("div");
      document.body.appendChild(probe);
      probe.style.background = "var(--color-pressed)";
      const pressed = getComputedStyle(probe).backgroundColor;
      probe.style.background = "var(--color-hover)";
      const hover = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { pressed, hover };
    });

    // Nested close: host may show hover but must not take the pressed wash.
    // Wait past --dur-fast so background-color transitions settle.
    const closeBox = await page.locator(".tab-close").boundingBox();
    expect(closeBox).toBeTruthy();
    await page.mouse.move(closeBox!.x + closeBox!.width / 2, closeBox!.y + closeBox!.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(160);
    const tabWhileChild = await page.locator(".tab").evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.mouse.up();

    // Primary select: host skips pressed; the primary itself takes it.
    const selectBox = await page.locator(".tab-select").boundingBox();
    expect(selectBox).toBeTruthy();
    await page.mouse.move(selectBox!.x + selectBox!.width / 2, selectBox!.y + selectBox!.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(160);
    const [tabWhilePrimary, selectWhilePrimary] = await Promise.all([
      page.locator(".tab").evaluate((el) => getComputedStyle(el).backgroundColor),
      page.locator(".tab-select").evaluate((el) => getComputedStyle(el).backgroundColor),
    ]);
    await page.mouse.up();

    const actionBox = await page.locator(".worker-action").boundingBox();
    expect(actionBox).toBeTruthy();
    await page.mouse.move(actionBox!.x + actionBox!.width / 2, actionBox!.y + actionBox!.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(160);
    const rowWhileChild = await page
      .locator(".worker-row")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.mouse.up();
    await page.close();

    expect(tabWhileChild, `tab took pressed while close held`).not.toBe(tokens.pressed);
    expect(tabWhilePrimary, `tab took pressed while select held`).not.toBe(tokens.pressed);
    expect(selectWhilePrimary, `tab-select missing pressed wash`).toBe(tokens.pressed);
    expect(rowWhileChild, `worker-row took pressed while action held`).not.toBe(tokens.pressed);
  }, 60_000);
});
