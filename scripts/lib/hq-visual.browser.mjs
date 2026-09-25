// scripts/lib/hq-visual.test.mjs — live HQ in a real browser against a mock
// Control API. Starts its own proxy on an ephemeral port, so `npm run hq:live`
// is not required. Screenshots land in the directory named by HQ_SHOT_DIR
// (default: a fresh temp dir printed at the end).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const TOKEN = "visual-test-token";
const shotDir = process.env.HQ_SHOT_DIR || mkdtempSync(join(tmpdir(), "hq-shots-"));
let apiServer;
let apiPort;
let hqProcess;
let hqPort;
let agentsDir;
let browser;

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function startMockApi() {
  // Shapes mirror the real handlers: /api/board returns WorkerBoardState
  // ({worker, column, attentionReason, contextUsage, testStatus}), messages
  // use role/content/createdAt, quota uses profileId/state/omniRouteOnline.
  const routes = {
    "/api/hq/v1/context": { cursor: 1, snapshot: { sourceTimestamp: "2026-09-10T12:00:00Z", commit: null,
      control: { status: "paused" }, goals: [{ id: "goal-1", projectId: "pj-1", objective: "Verify continuous development", acceptanceCriteria: "Claims and restart tests pass", status: "open" }],
      effectiveLimits: { rootPolicies: [{ policy: { teams: [{ id: "development", roles: ["coordinator", "implementer", "reviewer", "integrator"] }] } }] },
      tasks: [{ id: "task-1", goalId: "goal-1", objective: "Check ownership", profileId: "codex", status: "pending", attempts: 0, ownedPaths: ["src-tauri/src/queue.rs"], dependencies: [] }] } },
    "/api/hq/v1/runs": { executionEnabled: false, approvalAuthority: { state: "unavailable" }, runs: [] },
    "/api/projects": [{ id: "pj-1", name: "ProjectA" }],
    "/api/board": [
      {
        worker: { id: "wk-1", task: "Fix the dispatcher", status: "running", profileId: "claude", branch: "wk-dispatcher" },
        column: "working",
        contextUsage: { used: 42000, total: 200000 },
        attentionReason: "cargo check failed: Package gdk-3.0 was not found",
      },
      {
        worker: { id: "wk-2", task: "Review the review", status: "exited", profileId: "codex", branch: "wk-review" },
        column: "ready_to_merge",
        testStatus: "pass",
      },
    ],
    "/api/workers/wk-1": {
      worker: { id: "wk-1", task: "Fix the dispatcher", status: "running", profileId: "claude", branch: "wk-dispatcher" },
      column: "working",
      contextUsage: { used: 42000, total: 200000 },
    },
    "/api/workers/wk-1/messages": [
      { id: "m-1", workerId: "wk-1", role: "system", content: "worker created", createdAt: 1757500000 },
      { id: "m-2", workerId: "wk-1", role: "agent", content: "Inspecting queue.rs", createdAt: 1757500100 },
    ],
    "/api/queue": [{ id: "q-1", rawText: "Sharpen the plan", status: "queued" }],
    "/api/questions": [{ id: "qu-1", question: "Which database?", workerId: "wk-1" }],
    "/api/learnings": [],
    "/api/roles": [],
    "/api/activity": [{ createdAt: "2026-09-08T15:00:00Z", text: "worker wk-1 spawned" }],
    "/api/quota": [
      { profileId: "claude", state: "ok", blockedUntil: null, reason: null, omniRouteOnline: true },
      { profileId: "opencode", state: "blocked", blockedUntil: 1757600000, reason: "rate limit", omniRouteOnline: true },
    ],
    "/api/budgets": [{ profileId: "claude", fiveHourPct: 80, sevenDayPct: null }],
    "/api/usage": {
      online: true,
      authorized: true,
      events: [],
      today: { requests: 12, tokensIn: 340000, tokensOut: 90000, costUsd: 0, priced: 0 },
      total: { requests: 300, tokensIn: 9000000, tokensOut: 2000000, costUsd: 0, priced: 0 },
      reportedCostUsd: 4.21,
    },
    "/api/providers": [
      { id: "claude", kind: "subscription", connected: true, detail: "1.2.3", quotaState: "ok", blockedUntil: null, omniRouteOnline: true, usage: { percent: 42, source: "hook", used: "42k/100k" } },
      { id: "opencode", kind: "free_tier", connected: false, detail: null, quotaState: "unknown", blockedUntil: null, omniRouteOnline: true, usage: null },
    ],
    "/api/recommendations": [
      { id: "rc-1", projectId: "pj-1", title: "Add a file watcher", rationale: "Dispatcher polls every 30s; a watcher would react instantly", effort: "M", status: "new", url: null },
    ],
  };
  return createServer((req, res) => {
    const reply = (status, body) => {
      const text = JSON.stringify(body);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(text);
    };
    if (req.headers["x-projecta-token"] !== TOKEN) return reply(401, { error: "invalid api token" });
    const path = req.url.split("?")[0];
    if (req.method === "POST" && path === "/api/hq/v1/control") return reply(409, { error: "runtime adapters not attested" });
    if (req.method === "POST" && path === "/api/workers") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        spawnRequests.push(body);
        reply(200, { id: "wk-new", task: body.task, profileId: body.profileId, status: "running" });
      });
      return;
    }
    if (req.method === "POST" && /^\/api\/workers\/[^/]+\/send$/.test(path)) {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        sentMessages.push({ path, text: JSON.parse(Buffer.concat(chunks).toString()).text });
        reply(200, { ok: true });
      });
      return;
    }
    if (req.method === "POST" && /^\/api\/recommendations\/[^/]+\/accept$/.test(path)) {
      recommendationCalls.push({ path });
      reply(200, { id: "tq-from-rc", status: "ready" });
      return;
    }
    if (req.method === "POST" && /^\/api\/recommendations\/[^/]+\/status$/.test(path)) {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        recommendationCalls.push({ path, body: JSON.parse(Buffer.concat(chunks).toString()) });
        reply(200, { ok: true });
      });
      return;
    }
    if (routes[path]) return reply(200, routes[path]);
    reply(404, { error: `mock has no route for ${path}` });
  });
}

const spawnRequests = [];
const sentMessages = [];
const recommendationCalls = [];

function startHq() {
  return new Promise((resolve, reject) => {
    agentsDir = mkdtempSync(join(tmpdir(), "hq-agents-"));
    hqProcess = spawn(process.execPath, [join("scripts", "hq-live.mjs")], {
      env: {
        ...process.env,
        HQ_PORT: "0",
        // Ohne das schreibt hq-live beim Start docs/dev-hq/data.{js,json} im
        // ECHTEN Baum neu — der Test macht den Arbeitsbaum dreckig, und das
        // Ergebnis haengt davon ab, wie oft man ihn laufen laesst. Dieselbe
        // Stelle wie in hq-routes.test.mjs und hq-security.test.mjs; hier
        // fehlte sie, und der Waechter in scripts/ci/gates.sh hat sie am
        // 21.09. gefunden, als das Gate zum ersten Mal in einer Bahn lief.
        HQ_SKIP_SNAPSHOT: "1",
        PROJECTA_API_DESCRIPTOR: join(agentsDir, "descriptor.json"),
        PROJECTA_AGENTS_FILE: join(agentsDir, "agents.json"),
        HQ_LESSONS_FILE: join(agentsDir, "lessons.json"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    writeFileSync(join(agentsDir, "descriptor.json"), JSON.stringify({ port: apiPort, token: TOKEN }));
    // Two seed lessons so search, tags and the "seen ×" counter are visible.
    writeFileSync(join(agentsDir, "lessons.json"), JSON.stringify({ schema: 1, lessons: [
      { id: "L-seed000001", createdAt: "2026-09-01T00:00:00Z", lastSeen: "2026-09-07T00:00:00Z", hits: 3, symptom: "cargo check fails: Package gdk-3.0 was not found", cause: "GTK dev headers missing on the Linux runner", fix: "apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev", tags: ["cargo", "linux"], source: "AGENTS.md" },
      { id: "L-seed000002", createdAt: "2026-09-02T00:00:00Z", lastSeen: "2026-09-02T00:00:00Z", hits: 1, symptom: "Vite answers 504 Outdated Optimize Dep on every module", cause: "stale dependency cache", fix: "scripts/dev-fresh.cmd", tags: ["vite", "frontend"] },
    ] }));
    let stderr = "";
    hqProcess.stderr.on("data", (chunk) => { stderr += chunk; });
    hqProcess.stdout.on("data", (chunk) => {
      const match = /127\.0\.0\.1:(\d+)\/live\.html/.exec(chunk.toString());
      if (match) resolve(Number(match[1]));
    });
    hqProcess.on("exit", () => reject(new Error(`hq-live exited: ${stderr}`)));
  });
}

before(async () => {
  apiServer = startMockApi();
  apiPort = await listen(apiServer);
  hqPort = await startHq();
  // A pre-installed Chromium (e.g. the cloud runner's /opt/pw-browsers) can be
  // used without downloading the exact build this Playwright version pins.
  browser = await chromium.launch(
    process.env.HQ_CHROMIUM ? { executablePath: process.env.HQ_CHROMIUM } : {},
  );
});

after(async () => {
  await browser?.close();
  hqProcess?.kill();
  apiServer?.close();
  if (agentsDir) rmSync(agentsDir, { recursive: true, force: true });
  console.log(`screenshots: ${shotDir}`);
});

test("live HQ renders fleet, teams and telemetry from the mock API", async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${hqPort}/live.html`);
  await page.waitForSelector(".live-status.ok", { timeout: 15000 });

  assert.match(await page.textContent("#live-board"), /Fix the dispatcher/);
  assert.match(await page.textContent("#live-board"), /ready_to_merge/);
  assert.match(await page.textContent("#live-queue"), /Sharpen the plan/);
  assert.match(await page.textContent("#live-questions"), /Which database\?/);
  assert.match(await page.textContent("#live-teams"), /Claude Code/);
  assert.match(await page.textContent("#live-teams"), /Built-in agents/);
  assert.match(await page.textContent("#live-analysis"), /lines of code/);
  assert.match(await page.textContent("#live-capacity"), /claude/);
  assert.match(await page.textContent("#live-capacity"), /blocked/);
  assert.match(await page.textContent("#live-usage"), /4\.21/);
  assert.match(await page.textContent("#live-providers"), /claude/);
  assert.match(await page.textContent("#live-providers"), /not set/);
  assert.match(await page.textContent("#live-recommendations"), /Add a file watcher/);
  assert.match(
    await page.textContent("#live-teams"),
    /Offline preview; runtime path unverified/,
    "old runtime must not be confused with a verified active profile path",
  );
  await page.screenshot({ path: join(shotDir, "live-overview.png"), fullPage: true });
  await page.close();
});

test("continuous goals use the selected project and show blocked runtime honestly", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`http://127.0.0.1:${hqPort}/live.html`);
  await page.waitForSelector('.live-status.ok', { timeout: 20000 });
  await page.selectOption('#live-project', 'pj-1');
  await page.click('#tab-teams');
  await page.waitForFunction(() => document.querySelector('[data-goals]')?.textContent.includes('Verify continuous development'));
  assert.match(await page.textContent('[data-goals]'), /Check ownership/);
  assert.deepEqual(await page.locator('.continuous-assignment select[name="role"] option').allTextContents(), ['coordinator', 'implementer', 'reviewer', 'integrator']);
  assert.equal(await page.locator('.continuous-assignment button[type="submit"]').isDisabled(), true);
  await page.locator('[data-action=resume]').click();
  await page.waitForFunction(() => document.querySelector('[data-error]')?.textContent.includes('not attested'));
  assert.match(await page.textContent('[data-state]'), /paused/);
  await page.locator('.continuous-card').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(shotDir, 'continuous-goals.png'), fullPage: false });
  assert.equal(await page.locator('.continuous-card').evaluate(n => n.scrollWidth > n.clientWidth + 1), false);
  await page.close();
});

test("worker detail opens on click, shows messages, sends a reply", async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${hqPort}/live.html`);
  await page.waitForSelector(".live-status.ok", { timeout: 15000 });

  await page.click('[data-live-action="detail:wk-1"]');
  await page.waitForSelector("#worker-detail:not([hidden])", { timeout: 5000 });
  // The panel opens with "Loading…" and fills in once the messages arrive.
  await page.waitForFunction(
    () => !document.querySelector("#worker-detail")?.textContent?.includes("Loading…"),
    { timeout: 5000 },
  );
  assert.match(await page.textContent("#worker-detail"), /Inspecting queue\.rs/);
  assert.match(await page.textContent("#worker-detail"), /wk-dispatcher/);
  await page.screenshot({ path: join(shotDir, "worker-detail.png"), fullPage: true });

  await page.fill("#detail-message", "läuft gut, weiter so");
  await page.click('[data-live-action="detailSend"]');
  await page.waitForFunction(
    () => document.querySelector("#detail-status")?.textContent?.includes("sent"),
    { timeout: 10000 },
  );
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].path, "/api/workers/wk-1/send");
  assert.equal(sentMessages[0].text, "läuft gut, weiter so");
  await page.close();
});

test("spawning a worker posts project, task and chosen profile", async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(`http://127.0.0.1:${hqPort}/live.html`);
  await page.waitForSelector(".live-status.ok", { timeout: 15000 });

  await page.selectOption("#live-project", "pj-1");
  await page.waitForSelector(".live-status.ok", { timeout: 15000 });
  await page.click('.workspace-controls > summary');
  await page.fill("#live-spawn-task", "Refactor the board rail");
  await page.selectOption("#live-spawn-profile", "codex");
  await page.click('[data-live-action="spawn"]');
  await page.waitForFunction(
    () => document.querySelector("#live-spawn-status")?.textContent?.includes("wk-new"),
    { timeout: 10000 },
  );
  assert.equal(spawnRequests.length, 1);
  assert.equal(spawnRequests[0].projectId, "pj-1");
  assert.equal(spawnRequests[0].task, "Refactor the board rail");
  assert.equal(spawnRequests[0].profileId, "codex");
  await page.close();
});

test("accepting a recommendation posts to /accept, dismissing posts a status update", async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(`http://127.0.0.1:${hqPort}/live.html`);
  await page.waitForSelector(".live-status.ok", { timeout: 15000 });

  const waitForCalls = async (count) => {
    for (let i = 0; i < 100 && recommendationCalls.length < count; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(recommendationCalls.length, count, "recommendation call did not arrive in time");
  };

  await page.click('#tab-evidence');
  await page.click('[data-live-action="recAccept:rc-1"]');
  await waitForCalls(1);
  assert.equal(recommendationCalls[0].path, "/api/recommendations/rc-1/accept");

  await page.click('[data-live-action="recDismiss:rc-1"]');
  await waitForCalls(2);
  assert.equal(recommendationCalls[1].path, "/api/recommendations/rc-1/status");
  assert.equal(recommendationCalls[1].body.status, "dismissed");
  await page.close();
});

test("creating a team profile through the UI writes agents.json and lists it", async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${hqPort}/live.html`);
  await page.waitForSelector(".live-status.ok", { timeout: 15000 });

  await page.click('#tab-teams');
  await page.click("#live-new-team");
  await page.fill('#team-purpose', 'Find regressions');
  await page.fill('#team-role', 'Reviewer');
  await page.selectOption('#team-effort', 'Hoch');
  await page.fill('#team-tools', 'Diff and tests');
  await page.fill("#team-team", "Review crew");
  await page.fill("#team-id", "claude-review");
  await page.fill("#team-name", "Claude Reviewer");
  await page.fill("#team-command", "claude");
  await page.fill("#team-args", "--model, opus");
  await page.fill("#team-env", "ANTHROPIC_BASE_URL=http://127.0.0.1:20128");
  await page.selectOption("#team-fallback", "claude");
  await page.screenshot({ path: join(shotDir, "team-editor.png"), fullPage: true });
  await page.click("#team-save");
  await page.waitForFunction(
    () => document.querySelector("#team-editor-status")?.textContent?.includes("Saved"),
    { timeout: 10000 },
  );

  await page.waitForFunction(
    () => document.querySelector("#live-teams")?.textContent?.includes("Claude Reviewer"),
    { timeout: 10000 },
  );
  await page.screenshot({ path: join(shotDir, "team-created.png"), fullPage: true });

  // The proxy wrote the override file the running app would read next sweep.
  const agentsFile = join(agentsDir, "agents.json");
  assert.ok(existsSync(agentsFile));
  const written = JSON.parse((await import("node:fs")).readFileSync(agentsFile, "utf8"));
  const profile = written.profiles.find((p) => p.id === "claude-review");
  assert.equal(profile.name, "Claude Reviewer");
  assert.equal(profile.fallback, "claude");
  assert.equal(profile.env.ANTHROPIC_BASE_URL, "http://127.0.0.1:20128");
  assert.equal(profile.team, "Review crew");
  assert.deepEqual(profile.briefing, { purpose: 'Find regressions', role: 'Reviewer', effort: 'Hoch', tools: 'Diff and tests' });

  // …and the queue form now offers it for delegation.
  const options = await page.$$eval("#live-queue-profile option", (opts) => opts.map((o) => o.value));
  assert.ok(options.includes("claude-review"));

  // The editor keeps the saved fallback selected after the post-save refresh.
  assert.equal(await page.$eval("#team-fallback", (sel) => sel.value), "claude");
  await page.close();
});

test("setup helper, statistics and lessons render from the live proxy", async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${hqPort}/live.html`);
  await page.waitForSelector(".live-status.ok", { timeout: 20000 });
  await page.click('#tab-system');
  await page.waitForSelector(".setup-list", { timeout: 20000 });

  // Setup: the mock API is reachable, so the API check is green; the exe
  // check warns because the temp agents.json has no binary beside it.
  const setupText = await page.textContent("#live-setup");
  assert.match(setupText, /Setup helper/);
  assert.equal(await page.$eval('.setup-row.ok', (row) => row.textContent.includes("Control API answers") || true), true);
  assert.match(await page.$eval('.setup-row:has(strong:text("Control API answers"))', (row) => row.className), /\bok\b/);
  assert.match(await page.$eval('.setup-row:has(strong:text("agents.json"))', (row) => row.className), /\bwarn\b/);
  assert.match(setupText, /PROJECTA_AGENTS_FILE/);
  assert.match(setupText, /Continuous readiness/);
  assert.match(setupText, /blockers:\s*\d+/);

  // Statistics: sparkline with 14 bars, fleet distribution from the board.
  await page.click('#tab-stats');
  await page.waitForSelector("#live-stats .spark", { timeout: 20000 });
  assert.equal(await page.$$eval("#live-stats .spark-bar", (bars) => bars.length), 14);
  assert.match(await page.textContent("#live-stats"), /2 workers/);
  assert.match(await page.textContent("#live-stats"), /Rust tests/);

  // Lessons: search narrows, the counter grows when it happened again.
  await page.click('#tab-evidence');
  await page.waitForSelector(".lesson-row", { timeout: 10000 });
  assert.equal(await page.$$eval(".lesson-row", (rows) => rows.length), 2);
  await page.fill("#lesson-query", "gdk not found");
  await page.waitForFunction(() => document.querySelectorAll(".lesson-row").length === 1, { timeout: 5000 });
  assert.match(await page.textContent(".lesson-row"), /seen 3×/);
  await page.click('[data-live-action="lessonHit:L-seed000001"]');
  await page.waitForFunction(() => document.querySelector(".lesson-row")?.textContent.includes("seen 4×"), { timeout: 5000 });
  await page.screenshot({ path: join(shotDir, "lessons-search.png"), fullPage: true });

  // Adding writes through the proxy and shows up in the list.
  await page.click(".lesson-add summary");
  await page.fill("#lesson-symptom", "browserType.launch: Executable doesn't exist at /opt/pw-browsers");
  await page.fill("#lesson-cause", "playwright pins a newer chromium build than the preinstalled one");
  await page.fill("#lesson-fix", "HQ_CHROMIUM=/opt/pw-browsers/chromium/chrome npm run test:hq:visual");
  await page.fill("#lesson-tag-input", "playwright, tests");
  await page.click("#lesson-save");
  await page.waitForFunction(() => document.querySelector("#lesson-status")?.textContent.startsWith("Saved"), { timeout: 5000 });
  await page.fill("#lesson-query", "playwright");
  await page.waitForFunction(() => document.querySelector(".lesson-row")?.textContent.includes("browserType.launch"), { timeout: 5000 });
  const stored = JSON.parse((await import("node:fs")).readFileSync(join(agentsDir, "lessons.json"), "utf8"));
  assert.equal(stored.lessons.length, 3);

  // Nothing overflows its box: every card's scrollWidth fits its clientWidth.
  const overflowing = await page.$$eval(".live-card, .live-actions, .live-setup, .live-stats, .live-analysis, .live-row, .lesson-row, .setup-row, .stat-panel", (nodes) =>
    nodes.filter((n) => n.scrollWidth > n.clientWidth + 1).map((n) => `${n.className}: ${n.scrollWidth}>${n.clientWidth}`),
  );
  assert.deepEqual(overflowing, [], "text must not leave its box");
  await page.screenshot({ path: join(shotDir, "live-overview-v2.png"), fullPage: true });
  await page.close();
});

test("nothing overflows on a narrow 1024px desk either, and reduced motion draws instantly", async () => {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, reducedMotion: "reduce" });
  await page.goto(`http://127.0.0.1:${hqPort}/live.html`);
  await page.waitForSelector(".live-status.ok", { timeout: 20000 });
  await page.click('#tab-stats');
  await page.waitForSelector("#live-stats .spark", { timeout: 20000 });
  await page.click('#tab-evidence');
  await page.waitForSelector(".lesson-row", { timeout: 10000 });
  for (const tab of ['overview', 'teams', 'stats', 'evidence', 'system']) {
    await page.click(`#tab-${tab}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    const overflow = await page.$$eval('.workspace-panel:not([hidden]) .live-card, .workspace-panel:not([hidden]) .stat-panel', nodes => nodes.filter(n => n.scrollWidth > n.clientWidth + 1).map(n => n.className));
    assert.deepEqual(overflow, [], tab);
  }
  await page.click('#tab-overview');
  const overflowing = await page.$$eval(".live-card, .live-actions, .live-setup, .live-stats, .live-analysis, .live-row, .lesson-row, .setup-row, .stat-panel, .activity-row", (nodes) =>
    nodes.filter((n) => n.scrollWidth > n.clientWidth + 1).map((n) => `${n.className}: ${n.scrollWidth}>${n.clientWidth}`),
  );
  assert.deepEqual(overflowing, []);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, "no horizontal page scroll");
  const opacity = await page.$eval(".live-card", (n) => getComputedStyle(n).opacity);
  assert.equal(opacity, "1", "reduced motion: cards are visible without waiting for the rise animation");
  await page.screenshot({ path: join(shotDir, "live-1024.png"), fullPage: true });
  await page.close();
});

test("the memory learns: known fix appears on the fleet row, feedback moves the badge, refine keeps history", async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${hqPort}/live.html`);
  await page.waitForSelector(".live-status.ok", { timeout: 20000 });

  // A worker whose attention reason matches a lesson gets the fix inline.
  await page.waitForSelector('[data-live-action="detail:wk-1"] .known-fix', { timeout: 10000 });
  const chip = await page.textContent('[data-live-action="detail:wk-1"] .known-fix');
  assert.match(chip, /apt-get install -y libgtk-3-dev/);
  assert.equal(await page.$('[data-live-action="detail:wk-2"] .known-fix'), null, "a passing worker gets no chip");

  // Feedback: two "worked" votes make it proven, one "failed" opens the refine hint.
  await page.click('#tab-evidence');
  await page.waitForSelector(".lesson-row", { timeout: 10000 });
  await page.fill("#lesson-query", "gdk");
  await page.waitForFunction(() => document.querySelectorAll(".lesson-row").length === 1, { timeout: 5000 });
  assert.match(await page.textContent(".lesson-row .lesson-badge"), /recurring/);
  assert.ok((await page.$$eval(".lesson-row mark", (m) => m.length)) >= 1, "query tokens are highlighted");
  // HQ-21: the run id is typed into the card, no browser prompt any more.
  await page.click('[data-live-action="lessonWorked:L-seed000001"]');
  await page.fill(".lesson-row .run-id", "browser-run-1");
  await page.click('[data-live-action="lessonWorkedSend:L-seed000001"]');
  await page.waitForFunction(() => document.querySelector(".lesson-row")?.textContent.includes("100% worked"), { timeout: 5000 });
  await page.click('[data-live-action="lessonWorked:L-seed000001"]');
  await page.fill(".lesson-row .run-id", "browser-run-2");
  await page.click('[data-live-action="lessonWorkedSend:L-seed000001"]');
  await page.waitForFunction(() => document.querySelector(".lesson-row .lesson-badge")?.textContent === "proven", { timeout: 5000 });
  await page.click('[data-live-action="lessonFailed:L-seed000001"]');
  await page.fill(".lesson-row .run-id", "browser-run-3");
  await page.click('[data-live-action="lessonFailedSend:L-seed000001"]');
  await page.waitForFunction(() => document.querySelector(".lesson-row .lesson-extra")?.textContent.includes("did not help"), { timeout: 5000 });
  assert.match(await page.textContent(".lesson-row"), /67% worked/);

  // Refine: the new fix replaces the old one, the old one stays in history.
  await page.click('[data-live-action="lessonRefine:L-seed000001"]');
  await page.fill(".lesson-row .refine-fix", "apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev libsoup-3.0-dev");
  await page.fill(".lesson-row .refine-note", "soup was missing too");
  await page.click('[data-live-action="lessonRefineSave:L-seed000001"]');
  await page.waitForFunction(() => document.querySelector(".lesson-row .lesson-history")?.textContent.includes("1 earlier fix"), { timeout: 5000 });
  assert.match(await page.textContent(".lesson-row"), /libsoup-3\.0-dev/);

  // Related: the vite lesson shares nothing → says so; the sibling check runs on the other lesson.
  await page.click('[data-live-action="lessonRelated:L-seed000001"]');
  await page.waitForFunction(() => /Related|No related/.test(document.querySelector(".lesson-row .lesson-extra")?.textContent || ""), { timeout: 5000 });
  // Prose in the expandable area must flow, not fall into the label/value grid one word per line.
  const extraHeight = await page.$eval(".lesson-row .lesson-extra", (n) => n.getBoundingClientRect().height);
  assert.ok(extraHeight < 80, `related/feedback prose wraps as text, not one word per line (height ${extraHeight})`);
  await page.screenshot({ path: join(shotDir, "lessons-learning.png"), fullPage: true });

  const stored = JSON.parse((await import("node:fs")).readFileSync(join(agentsDir, "lessons.json"), "utf8"));
  const seed = stored.lessons.find((l) => l.id === "L-seed000001");
  assert.equal(seed.worked, 2);
  assert.equal(seed.failed, 1);
  assert.equal(seed.history.length, 1);
  await page.close();
});

test("static Lessons page renders the snapshot memory without the app", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`http://127.0.0.1:${hqPort}/lessons.html`);
  await page.waitForSelector(".lesson-row", { timeout: 10000 });
  const count = await page.$$eval(".lesson-row", (rows) => rows.length);
  assert.ok(count >= 10, `snapshot carries the checked-in lessons (${count})`);
  await page.fill("#lesson-query", "playwright");
  await page.waitForFunction(() => document.querySelectorAll(".lesson-row").length < 5, { timeout: 5000 });
  assert.match(await page.textContent("#static-lessons"), /HQ_CHROMIUM/);
  assert.equal(await page.$(".lesson-actions"), null, "static page has no write controls");
  const overflowing = await page.$$eval(".lesson-row, .summary-item", (nodes) => nodes.filter((n) => n.scrollWidth > n.clientWidth + 1).length);
  assert.equal(overflowing, 0);
  await page.screenshot({ path: join(shotDir, "lessons-static.png"), fullPage: false });
  await page.close();
});

test("the desk: ranked signals in the paper well, whole-project estimates with basis, keyboard shortcuts", async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${hqPort}/live.html`);
  await page.waitForSelector(".live-status.ok", { timeout: 20000 });
  await page.waitForSelector(".signal", { timeout: 20000 });

  // Signals: wk-1 has an attention reason and wk-2 is ready to merge → two "act" rows, first.
  const levels = await page.$$eval(".signal .signal-level", (n) => n.map((x) => x.textContent));
  assert.equal(levels[0], "act");
  const titles = await page.$$eval(".signal strong", (n) => n.map((x) => x.textContent));
  assert.ok(titles.some((t) => /Fix the dispatcher needs a human/.test(t)), titles.join(" | "));
  assert.ok(titles.some((t) => /Review the review is ready to merge/.test(t)));
  assert.ok(titles.some((t) => /opencode is quota-blocked/.test(t)));
  assert.ok(titles.some((t) => /claude 5-hour budget at 80%/.test(t)));
  // "open" on a worker signal opens the detail panel.
  await page.click('.signal.act [data-live-action^="goto:worker:wk-1"]');
  await page.waitForSelector("#worker-detail:not([hidden])", { timeout: 5000 });

  // Effort: time and tokens with basis; ledger from the mock usage (11 M) is the floor.
  await page.click('#tab-stats');
  await page.waitForSelector(".figure", { timeout: 20000 });
  const effort = await page.textContent("#live-effort");
  assert.match(effort, /Time invested/);
  assert.match(effort, /git sittings/);
  assert.match(effort, /Tokens consumed/);
  assert.match(effort, /ledger/);
  assert.match(effort, /\$4\.21/);
  assert.match(effort, /When the work happens/);
  assert.equal(await page.$$eval(".heat-cell", (c) => c.length), 168);

  // Keyboard: "/" focuses the memory search, "?" toggles help, Esc closes the detail.
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelector("#worker-detail").hidden === true, { timeout: 3000 });
  await page.keyboard.press("/");
  assert.equal(await page.evaluate(() => document.activeElement.id), "lesson-query");
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("?");
  assert.equal(await page.$eval("#live-keys-help", (n) => n.hidden), false);

  const overflowing = await page.$$eval(".desk-section, .figure, .signal, .live-card, .live-row, .stat-panel", (nodes) =>
    nodes.filter((n) => n.scrollWidth > n.clientWidth + 1).map((n) => `${n.className}: ${n.scrollWidth}>${n.clientWidth}`),
  );
  assert.deepEqual(overflowing, []);
  // The known-fix strip is a full-width line under its worker, never a sliver.
  await page.click('#tab-overview');
  const chipBox = await page.$eval('[data-live-action="detail:wk-1"] .known-fix', (n) => ({ w: n.getBoundingClientRect().width, h: n.getBoundingClientRect().height }));
  assert.ok(chipBox.w > 400 && chipBox.h < 120, `known-fix strip is wide and short (${chipBox.w}×${chipBox.h})`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(shotDir, "desk-v3-fold.png"), fullPage: false });
  await page.screenshot({ path: join(shotDir, "desk-v3.png"), fullPage: true });
  await page.close();
});
