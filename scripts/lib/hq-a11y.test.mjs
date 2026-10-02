// scripts/lib/hq-a11y.test.mjs - regressions for the ui-ux-pro-max audit of
// the Dev-HQ (.pa/report_uiux_audit_devhq.md). Every test names its finding.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const source = (path) => readFileSync(path, "utf8");
const HQ_JS = source("docs/dev-hq/hq.js");
const HQ_CSS = source("docs/dev-hq/hq.css");
const WORKSPACE_CSS = source("docs/dev-hq/workspace.css");

// Live page with a fetch that answers like the Control API proxy for the
// board and stays silent (404) for everything else; every helper that reads
// the silent routes catches its own error, so the desk still renders.
const BOARD = [
  { worker: { id: "wk-1", task: "Fix the dispatcher", status: "running", profileId: "claude" }, column: "working" },
  { worker: { id: "wk-2", task: "Review the review", status: "exited", profileId: "codex" }, column: "ready_to_merge" },
];
function liveFixture({ routes = {}, hash = "" } = {}) {
  const dom = new JSDOM(source("docs/dev-hq/live.html"), { url: `http://localhost/live.html${hash}`, runScripts: "outside-only" });
  const { window } = dom;
  window.HQ_DATA = JSON.parse(source("docs/dev-hq/data.json"));
  const calls = [];
  window.fetch = (url, options = {}) => {
    const path = String(url).replace(/^\/__hq/, "").split("?")[0];
    calls.push({ path, method: options.method || "GET", body: options.body });
    const body = path === "/api/projects" ? [] : path === "/api/board" ? BOARD : routes[path];
    if (body === undefined && path.startsWith("/api/")) return Promise.resolve({ ok: true, json: async () => [] });
    if (body === undefined) return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: "mock" }) });
    return Promise.resolve({ ok: true, json: async () => body });
  };
  window.matchMedia = () => ({ matches: true });
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.eval(source("docs/dev-hq/workspace.js"));
  const create = window.createHQWorkspace;
  let controller;
  window.createHQWorkspace = (...args) => (controller = create(...args));
  window.eval(source("docs/dev-hq/continuous.js"));
  window.eval(source("docs/dev-hq/hq.js"));
  return { dom, window, document: window.document, calls, controller };
}
async function settle(document, selector, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    if (document.querySelector(selector)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`${selector} never rendered`);
}
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("HQ-1: a live row with role=button opens on Enter and Space, not only on click", (t) => {
  const f = liveFixture(); t.after(() => f.dom.window.close());
  const { document: d, window: w } = f;
  const board = d.querySelector("#live-board");
  board.innerHTML = '<article class="live-row fleet-row" data-live-action="detail:wk-1" tabindex="0" role="button"><strong>wk-1</strong></article>';
  const row = board.firstElementChild;
  const clicks = [];
  row.addEventListener("click", () => clicks.push("click"));
  row.focus();
  row.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  const space = new w.KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
  row.dispatchEvent(space);
  assert.equal(clicks.length, 2, "Enter and Space each trigger the row's click action");
  assert.equal(space.defaultPrevented, true, "Space must not scroll the list");
  // A real button already handles its keys; the delegate must not double-fire.
  board.innerHTML = '<button class="hq-button" data-live-action="cancel:q-1">Cancel</button>';
  const button = board.firstElementChild;
  button.addEventListener("click", () => clicks.push("button"));
  button.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  assert.equal(clicks.filter((c) => c === "button").length, 0);
});

test("HQ-2: no rule switches the focus ring off again", () => {
  // A :not(:focus-visible) guard legitimately hides the ring for pointer
  // focus only — strip those guards before scanning for real violations.
  const withoutNotGuard = HQ_CSS.replace(/:not\(:focus-visible\)/g, "");
  assert.doesNotMatch(withoutNotGuard, /:focus-visible[^{]*\{[^}]*outline:\s*0/);
  assert.doesNotMatch(withoutNotGuard, /:focus-visible[^{]*\{[^}]*outline:\s*none/);
  // Round 2 (finding A-7): the skip link (HQ-18) lands on #mount, so a bare
  // outline:none there swallows the only focus indicator after skipping.
  assert.doesNotMatch(HQ_CSS, /#mount:focus\s*\{[^}]*outline:\s*none/);
});

test("HQ-8: control outlines use the strong hairline, decorative dividers keep the soft one", () => {
  const rule = (selector) => {
    const m = WORKSPACE_CSS.match(new RegExp(`${escapeRegExp(selector)}[^{]*\\{([^}]*)\\}`));
    assert.ok(m, `${selector} rule exists`);
    return m[1];
  };
  assert.match(rule(".hq-workspace input, .hq-workspace select, .hq-workspace textarea"), /border:\s*1px solid var\(--hair-strong\)/);
  assert.match(rule(".hq-workspace .hq-button"), /border:\s*1px solid var\(--hair-strong\)/);
  assert.match(rule(".continuous-card input, .continuous-card textarea, .continuous-card select"), /border:\s*1px solid var\(--hair-strong\)/);
  assert.match(rule(".hq-workspace .live-card, .hq-workspace .live-actions, .hq-workspace .stat-panel, .hq-workspace .live-setup"), /border:\s*1px solid var\(--hair\)/);
});

test("HQ-4: aria-live stays on single status lines, never on a region full of headings, tables or charts", (t) => {
  const f = liveFixture(); t.after(() => f.dom.window.close());
  const offenders = [...f.document.querySelectorAll("[aria-live]")].filter((node) => node.querySelector("h2, h3, table, svg, ul, ol, details"));
  assert.deepEqual(offenders.map((n) => n.id || n.tagName), []);
  for (const id of ["live-stats", "live-analysis", "live-setup"]) {
    assert.equal(f.document.getElementById(id).hasAttribute("aria-live"), false, `#${id} must not be a live region`);
  }
  assert.equal(f.document.querySelector("[data-budget]").hasAttribute("aria-live"), false);
  assert.equal(f.document.querySelector("[data-runs]").hasAttribute("aria-live"), false);
  assert.equal(f.document.querySelector("#live-status").getAttribute("role"), "status");
});

test("HQ-7: the global error box is announced as an alert", (t) => {
  const f = liveFixture(); t.after(() => f.dom.window.close());
  assert.equal(f.document.querySelector("#live-error").getAttribute("role"), "alert");
});

test("HQ-6: every scrolling list and the signal well are keyboard reachable and named", (t) => {
  const f = liveFixture(); t.after(() => f.dom.window.close());
  const lists = [...f.document.querySelectorAll(".live-card .live-list")];
  assert.ok(lists.length >= 9, `expected the desk lists, got ${lists.length}`);
  for (const list of lists) {
    assert.equal(list.getAttribute("tabindex"), "0", `${list.id} focusable`);
    assert.equal(list.getAttribute("role"), "group", `${list.id} grouped`);
    const title = list.closest(".live-card").querySelector("h2").textContent.trim();
    assert.equal(list.getAttribute("aria-label"), title, `${list.id} named after its card`);
  }
  const signals = f.document.querySelector("#live-signals");
  assert.equal(signals.getAttribute("tabindex"), "0");
  assert.ok(signals.getAttribute("aria-label"));
});

test("HQ-3: focus on a fleet row survives the periodic refresh", async (t) => {
  const f = liveFixture(); t.after(() => f.dom.window.close());
  const { document: d } = f;
  await settle(d, "#live-board .fleet-row");
  const row = d.querySelector('[data-live-action="detail:wk-2"]');
  row.focus();
  assert.equal(d.activeElement, row);
  d.querySelector("#live-refresh").click();
  await new Promise((resolve) => setTimeout(resolve, 60));
  const again = d.querySelector('[data-live-action="detail:wk-2"]');
  assert.notEqual(again, row, "the list was re-rendered");
  assert.equal(d.activeElement, again, "focus returned to the same worker row");
});

test("HQ-10/HQ-22: setup rows state their status as text, the dot is decorative and escaped", async (t) => {
  const f = liveFixture({ routes: { "/setup": {
    ready: false, summary: "one fix", generatedAt: "2026-09-16T10:00:00Z", counts: { warn: 1, fail: 1 }, fixScript: [],
    checks: [
      { id: "node", label: "Node", state: "ok", detail: "v24" },
      { id: "hooks", label: "Hooks", state: "warn", detail: "not set", fix: "git config core.hooksPath .githooks" },
      { id: "x", label: "Odd", state: 'fail" onmouseover="x', detail: "broken" },
    ],
  } } }); t.after(() => f.dom.window.close());
  await settle(f.document, ".setup-row");
  const rows = [...f.document.querySelectorAll(".setup-row")];
  assert.equal(rows.length, 3);
  assert.equal(rows[0].querySelector(".setup-verdict").textContent, "ok");
  assert.equal(rows[1].querySelector(".setup-verdict").textContent, "warn");
  for (const row of rows) {
    const dot = row.querySelector(".setup-state");
    assert.equal(dot.getAttribute("aria-hidden"), "true");
    assert.equal(dot.hasAttribute("aria-label"), false);
  }
  assert.equal(f.document.querySelector("[onmouseover]"), null, "state value is escaped");
});

test("HQ-13: the Now page milestone list is plain text plus one link, no tab stops inside", () => {
  const dom = new JSDOM(source("docs/dev-hq/index.html"), { url: "http://localhost/index.html", runScripts: "outside-only" });
  dom.window.HQ_DATA = JSON.parse(source("docs/dev-hq/data.json"));
  dom.window.matchMedia = () => ({ matches: true });
  dom.window.eval(HQ_JS);
  const items = dom.window.document.querySelectorAll(".signal-list li");
  assert.ok([...items].some((li) => /^M\d/.test(li.querySelector("strong")?.textContent ?? "")), "milestone list drawn");
  assert.equal(dom.window.document.querySelectorAll("li [tabindex]").length, 0);
  dom.window.close();
});

test("W1-17 milestone views escape PLAN.md text and label every state", () => {
  const milestones = [{
    id: "M9", title: "<img src=x onerror=alert(1)>", done: 1, total: 4,
    packages: ["done", "pr", "in_progress", "open"].map((state, n) => ({
      id: `A-${n}`, title: "<b>bold</b>", size: "S", lane: "<i>doc</i>", stand: "<u>stand</u>", state, prNumbers: [],
    })),
  }];
  const open = (page) => {
    const dom = new JSDOM(source(`docs/dev-hq/${page}.html`), { url: `http://localhost/${page}.html`, runScripts: "outside-only" });
    dom.window.HQ_DATA = { ...JSON.parse(source("docs/dev-hq/data.json")), milestones };
    dom.window.matchMedia = () => ({ matches: true });
    dom.window.eval(HQ_JS);
    return dom;
  };
  const map = open("map");
  const doc = map.window.document;
  assert.equal(doc.querySelector("img, b, i, u"), null, "PLAN.md text is escaped, not parsed as HTML");
  assert.equal(doc.querySelector(".section-title h2").textContent, "M9 — <img src=x onerror=alert(1)>");
  assert.equal(doc.querySelector(".section-title p").textContent, "1/4 packages done");
  assert.deepEqual([...doc.querySelectorAll(".package-state")].map((el) => el.textContent), ["done", "PR open", "in progress", "open"]);
  map.window.close();
  const now = open("index");
  assert.equal(now.window.document.querySelector("img, b, i, u"), null);
  const item = [...now.window.document.querySelectorAll(".signal-list li")].find((li) => li.querySelector("strong")?.textContent === "M9");
  assert.equal(item.querySelector("em").textContent, "1/4");
  now.window.close();
});

test("HQ-19 / HQ-20: no hover-only hint on the map legend and no dormant number animation", () => {
  assert.doesNotMatch(HQ_JS, /Hover nodes/);
  assert.doesNotMatch(HQ_JS, /animateNumbers|data-count=|data-suffix=/);
});

test("HQ-5: every assignment field is tied to its visible label", async (t) => {
  const dom = new JSDOM("<main></main>", { runScripts: "outside-only" });
  t.after(() => dom.window.close());
  dom.window.eval(source("docs/dev-hq/continuous.js"));
  const context = { snapshot: {
    control: { status: "paused" },
    effectiveLimits: { rootPolicies: [{ policy: { teams: [{ id: "development", roles: ["implementer"] }] } }] },
    goals: [{ id: "g1", objective: "Ship", status: "open", acceptanceCriteria: "Checks pass" }],
    tasks: [{ id: "t1", goalId: "g1", objective: "Implement", status: "open", attempts: 0, ownedPaths: [], dependencies: [] }],
  } };
  const controller = dom.window.createHQContinuous({ container: dom.window.document.querySelector("main"), api: async () => context, project: () => "p1" });
  await controller.refresh();
  const form = dom.window.document.querySelector(".continuous-assignment");
  for (const name of ["teamId", "role", "assignee"]) {
    const field = form.elements[name];
    assert.equal(field.labels.length, 1, `${name} has exactly one label`);
    assert.ok(field.labels[0].textContent.trim().length > 0, `${name} label has text`);
  }
});

test("HQ-15: ending the continuous run asks first; a declined confirm sends nothing", async (t) => {
  const dom = new JSDOM("<main></main>", { runScripts: "outside-only" });
  t.after(() => dom.window.close());
  dom.window.eval(source("docs/dev-hq/continuous.js"));
  const calls = [];
  const controller = dom.window.createHQContinuous({
    container: dom.window.document.querySelector("main"),
    api: async (path, options) => { if (options) calls.push(JSON.parse(options.body)); return { snapshot: { goals: [], tasks: [], control: { status: "running" } } }; },
    project: () => "p1",
  });
  await controller.refresh();
  let answer = false;
  dom.window.confirm = () => answer;
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  dom.window.document.querySelector("[data-action=cancel]").click(); await tick();
  assert.deepEqual(calls, [], "declined confirm sends no control action");
  answer = true;
  dom.window.document.querySelector("[data-action=cancel]").click(); await tick();
  assert.deepEqual(calls.map((c) => c.action), ["cancel"]);
  dom.window.confirm = () => { throw new Error("pause must not ask"); };
  dom.window.document.querySelector("[data-action=pause]").click(); await tick();
  assert.deepEqual(calls.map((c) => c.action), ["cancel", "pause"]);
});

test("HQ-18: every page starts with a skip link that lands on a focusable main", () => {
  for (const page of ["index", "proof", "map", "next", "sources", "lessons", "live"]) {
    const dom = new JSDOM(source(`docs/dev-hq/${page}.html`));
    const root = dom.window.document.getElementById("hq-root");
    const first = root.firstElementChild;
    assert.equal(first.tagName, "A", `${page}: first child is the skip link`);
    assert.equal(first.className, "skip-link");
    assert.equal(first.getAttribute("href"), "#mount");
    assert.equal(dom.window.document.getElementById("mount").getAttribute("tabindex"), "-1", `${page}: main takes focus`);
    dom.window.close();
  }
  assert.match(HQ_CSS, /\.skip-link\s*\{[^}]*position:\s*absolute/);
  assert.match(HQ_CSS, /\.skip-link:focus-visible\s*\{[^}]*top:\s*0\.75rem/);
});

test("HQ-12: the Live page is German with its English blocks marked", (t) => {
  const f = liveFixture(); t.after(() => f.dom.window.close());
  assert.equal(f.document.documentElement.lang, "de");
  const cards = [...f.document.querySelectorAll(".live-card:not(.continuous-card)")];
  assert.ok(cards.length >= 9);
  assert.ok(cards.every((card) => card.getAttribute("lang") === "en"), "every hq.js card is English");
  assert.equal(f.document.querySelector("#live-controls").getAttribute("lang"), "en");
  assert.equal(f.document.querySelector("#team-editor").getAttribute("lang"), null, "the German team editor inherits de");
  assert.equal(f.document.querySelector(".continuous-card").closest("[lang]"), f.document.documentElement, "continuous card is German");
});

test("HQ-14: single-key shortcuts can be switched off and never fire while editing text", (t) => {
  const f = liveFixture(); t.after(() => f.dom.window.close());
  const { document: d, window: w } = f;
  const toggle = d.querySelector("#live-keys-enabled");
  assert.equal(toggle.checked, true, "on by default");
  d.body.focus();
  d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "f", bubbles: true }));
  assert.equal(d.activeElement.id, "live-fleet-filter", "shortcut works while on");
  d.activeElement.blur();
  toggle.checked = false;
  toggle.dispatchEvent(new w.Event("change"));
  d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "f", bubbles: true }));
  assert.notEqual(d.activeElement.id, "live-fleet-filter", "shortcut is off");
  assert.equal(w.localStorage.getItem("hq.shortcuts"), "off");
  const help = d.querySelector("#live-keys-help");
  help.hidden = false;
  d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(help.hidden, true, "Escape is not a single-key shortcut and keeps working");
  toggle.checked = true;
  const editable = d.createElement("div");
  editable.setAttribute("contenteditable", "true");
  editable.tabIndex = 0;
  d.body.append(editable);
  editable.focus();
  Object.defineProperty(editable, "isContentEditable", { value: true });
  d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "f", bubbles: true }));
  assert.equal(d.activeElement, editable, "typing in contenteditable is not a shortcut");
});

test("HQ-17: the team selector is a radiogroup with one tab stop and arrow keys", (t) => {
  const f = liveFixture(); t.after(() => f.dom.window.close());
  const { document: d, window: w } = f;
  d.querySelector("#live-teams").innerHTML = '<div class="team-group"><h3>Review</h3><article class="live-row">One</article></div><div class="team-group"><h3>Build</h3><article class="live-row">Two</article></div>';
  f.controller.teamsChanged();
  const group = d.querySelector(".workspace-team-nav");
  assert.equal(group.getAttribute("role"), "radiogroup");
  const radios = [...group.children];
  assert.ok(radios.length >= 2);
  assert.ok(radios.every((r) => r.getAttribute("role") === "radio"));
  assert.equal(radios.filter((r) => r.tabIndex === 0).length, 1, "exactly one tab stop");
  assert.equal(radios.filter((r) => r.getAttribute("aria-checked") === "true").length, 1);
  const first = radios.find((r) => r.getAttribute("aria-checked") === "true");
  first.focus();
  group.dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  const second = radios[(radios.indexOf(first) + 1) % radios.length];
  assert.equal(d.activeElement, second);
  assert.equal(second.getAttribute("aria-checked"), "true");
  assert.equal(second.tabIndex, 0);
  assert.equal(first.getAttribute("aria-checked"), "false");
});

test("HQ-16: the proof matrix marks the pressed cell and announces the filter", () => {
  const dom = new JSDOM(source("docs/dev-hq/proof.html"), { url: "http://localhost/proof.html", runScripts: "outside-only" });
  dom.window.HQ_DATA = JSON.parse(source("docs/dev-hq/data.json"));
  dom.window.matchMedia = () => ({ matches: true });
  dom.window.eval(HQ_JS);
  const d = dom.window.document;
  const status = d.getElementById("finding-status");
  assert.equal(status.getAttribute("role"), "status");
  assert.match(status.textContent, /^\d+ findings, no filter$/);
  const cells = [...d.querySelectorAll(".matrix-cell")];
  assert.ok(cells.length > 0);
  assert.ok(cells.every((c) => c.getAttribute("aria-pressed") === "false"));
  const cell = cells.find((c) => Number(c.textContent) > 0) || cells[0];
  cell.click();
  assert.equal(cell.getAttribute("aria-pressed"), "true");
  assert.equal(cells.filter((c) => c.getAttribute("aria-pressed") === "true").length, 1);
  assert.match(status.textContent, /^\d+ of \d+ findings · filter /);
  cell.click();
  assert.equal(cell.getAttribute("aria-pressed"), "false");
  assert.match(status.textContent, /no filter$/);
  dom.window.close();
});

test("review A-2: a refresh leaves a list alone while the user types in it", async (t) => {
  const f = liveFixture(); t.after(() => f.dom.window.close());
  const { document: d } = f;
  await settle(d, "#live-board .fleet-row");
  const board = d.querySelector("#live-board");
  board.insertAdjacentHTML("beforeend", '<div class="lesson-extra"><input class="refine-fix" value="typing"></div>');
  const input = board.querySelector(".refine-fix");
  input.focus();
  d.querySelector("#live-refresh").click();
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(d.activeElement, input, "the input survived the refresh");
  assert.equal(board.querySelector(".refine-fix").value, "typing");
});

test("review A-4: a setup state that is not a plain word cannot inject extra classes", async (t) => {
  const f = liveFixture({ routes: { "/setup": {
    ready: true, summary: "", generatedAt: "2026-09-17T10:00:00Z", counts: { warn: 0, fail: 0 }, fixScript: [],
    checks: [{ id: "x", label: "Odd", state: "ok evil-class", detail: "d" }],
  } } }); t.after(() => f.dom.window.close());
  await settle(f.document, ".setup-row");
  const row = f.document.querySelector(".setup-row");
  assert.deepEqual([...row.classList], ["setup-row", "okevilclass"]);
  assert.equal(row.querySelector(".setup-verdict").textContent, "ok evil-class");
});

test("HQ-11: the control fields carry visible labels", (t) => {
  const f = liveFixture(); t.after(() => f.dom.window.close());
  for (const [id, text] of [["live-worker-id", "Worker id"], ["live-message", "Message"], ["live-queue-text", "Task to queue"], ["live-queue-profile", "Agent profile"], ["live-spawn-task", "Spawn task"], ["live-spawn-profile", "Spawn profile"]]) {
    const field = f.document.getElementById(id);
    assert.equal(field.labels.length, 1, `${id} has a label`);
    assert.match(field.labels[0].textContent, new RegExp(text), `${id} label text`);
    assert.equal(field.hasAttribute("aria-label"), false, `${id} no longer relies on aria-label`);
  }
});

test("HQ-9: charts are followed by a table with the same numbers; the milestone tables have column headers", () => {
  assert.match(HQ_JS, /chart-table.*Commits per day/);
  assert.match(HQ_JS, /chart-table.*Commits by weekday and hour/);
  const dom = new JSDOM(source("docs/dev-hq/map.html"), { url: "http://localhost/map.html", runScripts: "outside-only" });
  dom.window.HQ_DATA = JSON.parse(source("docs/dev-hq/data.json"));
  dom.window.matchMedia = () => ({ matches: true });
  dom.window.eval(HQ_JS);
  const tables = [...dom.window.document.querySelectorAll(".package-table")];
  assert.ok(tables.length > 0, "one table per milestone");
  assert.ok(tables.every((t) => t.querySelectorAll('thead th[scope="col"]').length === 5));
  dom.window.close();
});

test("HQ-21: a question is answered in the row, not in a browser prompt", async (t) => {
  const f = liveFixture({ routes: {
    "/api/questions": [{ id: "qu-1", question: "Which database?", workerId: "wk-1" }],
    "/api/questions/qu-1/answer": { ok: true },
  } }); t.after(() => f.dom.window.close());
  const { document: d, window: w } = f;
  w.prompt = () => { throw new Error("window.prompt must not be used"); };
  await settle(d, '[data-live-action="answer:qu-1"]');
  d.querySelector('[data-live-action="answer:qu-1"]').click();
  const field = d.querySelector("#live-questions .answer-text");
  assert.ok(field, "an inline field appears");
  assert.match(field.labels[0].textContent, /Antwort/);
  assert.equal(d.activeElement, field);
  field.value = "Postgres";
  d.querySelector('[data-live-action="answerSend:qu-1"]').click();
  await new Promise((resolve) => setTimeout(resolve, 30));
  const sent = f.calls.find((c) => c.path === "/api/questions/qu-1/answer");
  assert.ok(sent, "the answer was posted");
  assert.deepEqual(JSON.parse(sent.body), { answer: "Postgres" });
});

test("HQ-21 round 2 (finding A-5): Escape cancels the inline answer form and returns focus", async (t) => {
  const f = liveFixture({ routes: {
    "/api/questions": [{ id: "qu-1", question: "Which database?", workerId: "wk-1" }],
  } }); t.after(() => f.dom.window.close());
  const { document: d, window: w } = f;
  await settle(d, '[data-live-action="answer:qu-1"]');
  const trigger = d.querySelector('[data-live-action="answer:qu-1"]');
  trigger.click();
  const field = d.querySelector("#live-questions .answer-text");
  assert.ok(field, "an inline field appears");
  field.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  assert.equal(d.querySelector("#live-questions .answer-form"), null, "Escape removes the form");
  assert.equal(d.activeElement, trigger, "focus returns to the trigger button");
});

test("HQ-21: lesson feedback asks for the run id in the card", async (t) => {
  const lesson = { id: "L1", symptom: "boom", cause: "c", fix: "f", tags: [], hits: 1, badges: { label: "new", confidence: null } };
  const f = liveFixture({ routes: {
    "/lessons": { lessons: [lesson], stats: { tags: [], count: 1, hits: 1 } },
    "/lessons/L1/worked": { lesson: { ...lesson, badges: { label: "recurring", confidence: 100 } } },
  } }); t.after(() => f.dom.window.close());
  const { document: d, window: w } = f;
  w.prompt = () => { throw new Error("window.prompt must not be used"); };
  await settle(d, '[data-live-action="lessonWorked:L1"]');
  d.querySelector('[data-live-action="lessonWorked:L1"]').click();
  const run = d.querySelector('.lesson-row[data-lesson-id="L1"] .run-id');
  assert.ok(run, "run id field appears in the card");
  assert.match(run.labels[0].textContent, /Run-ID/);
  d.querySelector('[data-live-action="lessonWorkedSend:L1"]').click();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(f.calls.some((c) => c.path === "/lessons/L1/worked"), false, "nothing is sent without a run id");
  assert.match(d.querySelector('.lesson-row[data-lesson-id="L1"] .run-status').textContent, /Run-ID fehlt/);
  run.value = "run-42";
  d.querySelector('[data-live-action="lessonWorkedSend:L1"]').click();
  await new Promise((resolve) => setTimeout(resolve, 30));
  const sent = f.calls.find((c) => c.path === "/lessons/L1/worked");
  assert.ok(sent);
  assert.deepEqual(JSON.parse(sent.body), { runId: "run-42" });
});
