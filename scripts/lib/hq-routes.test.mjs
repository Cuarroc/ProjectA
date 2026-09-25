// scripts/lib/hq-routes.test.mjs — the live proxy's own routes
// (/__hq/setup, /__hq/stats, /__hq/lessons) against a real spawned instance.
// Separate from hq-security.test.mjs so red-first can prove this file was
// missing at the merge-base.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request, createServer } from "node:http";

let hqProcess;
let hqPort;
let agentsDir;

function get(path, headers = {}, port = hqPort) {
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: "127.0.0.1", port, path, method: "GET", headers },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function startHq() {
  agentsDir = mkdtempSync(join(tmpdir(), "hq-routes-"));
  const started = spawnHq(agentsDir);
  hqProcess = started.child;
  return started.port;
}

function spawnHq(dir, extraEnv = {}) {
  let child;
  const port = new Promise((resolve, reject) => {
    child = spawn(process.execPath, [join("scripts", "hq-live.mjs")], {
      env: {
        ...process.env,
        ...extraEnv,
        HQ_PORT: "0",
        // Ohne das regeneriert hq-live docs/dev-hq/data.json und data.js im
        // ECHTEN Baum — ein Test, der getrackte Dateien anfasst, macht den
        // Arbeitsbaum bei jedem `prepush` dreckig. Geprueft werden hier
        // Routen bzw. Absicherung, nicht die Erzeugung des Snapshots.
        HQ_SKIP_SNAPSHOT: "1",
        PROJECTA_API_DESCRIPTOR: join(dir, "descriptor.json"),
        PROJECTA_AGENTS_FILE: join(dir, "agents.json"),
        HQ_LESSONS_FILE: join(dir, "lessons.json"),
        // The insights estimate reads the agent journal `.pa/ACTIVITY.md`,
        // which is deliberately untracked (instance-local append log). Point
        // it into the temp dir (no fixture written: journal stays empty) so
        // a host journal can never leak into a test — hermetic instead of
        // host state.
        HQ_ACTIVITY_FILE: join(dir, "ACTIVITY.md"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    writeFileSync(join(dir, "descriptor.json"), JSON.stringify({ port: 1, token: "unused" }));
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.on("data", (chunk) => {
      const match = /127\.0\.0\.1:(\d+)\/live\.html/.exec(chunk.toString());
      if (match) resolve(Number(match[1]));
    });
    child.on("exit", () => reject(new Error(`hq-live exited: ${stderr}`)));
  });
  return { child, port };
}

// Synthetic history for /__hq/insights: the public repository starts from a
// single squashed commit, so its real history says nothing about effort.
// One sitting of four commits within 90 minutes (80 min + 30 min lead =
// 1.83 h) and 2,000 changed lines (2,000 × 10 × 6 = 120,000 tokens).
function syntheticRepo(dir) {
  const repo = join(dir, "repo");
  mkdirSync(repo);
  // A git hook (pre-push) exports GIT_DIR; it would point these commands at
  // the real repository instead of the temp one.
  const { GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, ...cleanEnv } = process.env;
  const git = (args, env = {}) => {
    const result = spawnSync("git", ["-c", "user.name=HQ Test", "-c", "user.email=hq-test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
      cwd: repo,
      encoding: "utf8",
      env: { ...cleanEnv, ...env },
    });
    assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  };
  git(["init", "-q"]);
  const start = Math.floor(Date.now() / 1000) - 2 * 86400;
  [0, 30, 60, 80].forEach((minutes, index) => {
    writeFileSync(join(repo, `part-${index}.txt`), Array.from({ length: 500 }, (_, line) => `line ${line}`).join("\n") + "\n");
    git(["add", "."]);
    const date = `@${start + minutes * 60} +0000`;
    git(["commit", "-q", "-m", `part ${index}`], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  });
  return repo;
}

before(async () => { hqPort = await startHq(); });
after(async () => {
  hqProcess?.kill();
  if (agentsDir) rmSync(agentsDir, { recursive: true, force: true });
});

async function session(port = hqPort) {
  const html = (await get("/live.html", {}, port)).body;
  return /name="hq-session" content="([0-9a-f]+)"/.exec(html)[1];
}

function post(path, body, headers = {}, port = hqPort) {
  return new Promise((resolve, reject) => {
    const text = JSON.stringify(body);
    const req = request(
      { hostname: "127.0.0.1", port, path, method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(text), ...headers } },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    req.end(text);
  });
}

test("/__hq/setup runs the checklist and names the stale descriptor as the blocker", async () => {
  const headers = { host: `127.0.0.1:${hqPort}`, "x-hq-session": await session() };
  const reply = await get("/__hq/setup", headers);
  assert.equal(reply.status, 200);
  const setup = JSON.parse(reply.body);
  assert.ok(Array.isArray(setup.checks) && setup.checks.length >= 10);
  const api = setup.checks.find((c) => c.id === "api");
  assert.equal(api.state, "fail", "descriptor points at port 1 — the API check must fail, not pass by absence");
  assert.match(api.fix, /Restart ProjectA/);
  assert.equal(setup.ready, false);
  assert.ok(setup.checks.find((c) => c.id === "specs").state === "ok", "spec gate runs from the repo root");
  assert.equal(setup.continuousReadiness.continuousEligible, false);
  assert.equal(setup.continuousReadiness.releaseEligible, false);
  assert.ok(setup.continuousReadiness.blockers.some((blocker) => blocker.id === "attestation:providers"));
});

test("/__hq/stats reports commit series, test surface and lesson counts", async () => {
  const headers = { host: `127.0.0.1:${hqPort}`, "x-hq-session": await session() };
  const stats = JSON.parse((await get("/__hq/stats", headers)).body);
  assert.equal(stats.commitsPerDay.length, 14);
  assert.ok(stats.tests.frontendTestFiles > 10);
  assert.ok(stats.tests.rustTests > 100, `rust tests counted: ${stats.tests.rustTests}`);
  assert.ok(stats.snapshot.specs.total >= 1);
  assert.equal(typeof stats.lessons.count, "number");
});

test("/__hq/lessons: add, search, merge duplicates, count repeats — and refuse junk", async () => {
  const headers = { host: `127.0.0.1:${hqPort}`, "x-hq-session": await session() };
  const lesson = { symptom: "cargo check: Package gdk-3.0 was not found", cause: "GTK dev headers missing", fix: "apt-get install libgtk-3-dev", tags: ["cargo"] };
  const added = JSON.parse((await post("/__hq/lessons", lesson, headers)).body);
  assert.equal(added.ok, true);
  assert.equal(added.merged, false);
  const again = JSON.parse((await post("/__hq/lessons", lesson, headers)).body);
  assert.equal(again.merged, true);
  assert.equal(again.lesson.hits, 2);
  const found = JSON.parse((await get("/__hq/lessons?q=gdk%20not%20found", headers)).body);
  assert.equal(found.lessons[0].id, added.lesson.id);
  assert.equal(found.stats.count, 1);
  const hit = await post(`/__hq/lessons/${added.lesson.id}/hit`, {}, headers);
  assert.equal(hit.status, 200);
  assert.equal(JSON.parse((await get("/__hq/lessons", headers)).body).lessons[0].hits, 3);
  const junk = await post("/__hq/lessons", { symptom: "x" }, headers);
  assert.equal(junk.status, 400);
  assert.equal((await post("/__hq/lessons/L-nope/hit", {}, headers)).status, 404);
});

test("the new /__hq routes stay behind host + session checks", async () => {
  for (const path of ["/__hq/setup", "/__hq/stats", "/__hq/lessons"]) {
    assert.equal((await get(path, { host: "evil.example" })).status, 403, path);
    assert.equal((await get(path, { host: `127.0.0.1:${hqPort}` })).status, 403, path);
  }
});

test('HQ labels compiled-default agreement separately from a runtime profile path', async () => {
  const raw = readFileSync('src-tauri/resources/agent-defaults.json', 'utf8');
  const digest = createHash('sha256').update(raw.replace(/\r\n/g, '\n')).digest('hex');
  let runtimeDigest = digest;
  const api = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ apiVersion: 1, profilesPath: join(agentsDir, 'agents.json'), provenance: { builtinManifestSha256: runtimeDigest } }));
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  const descriptor = join(agentsDir, 'descriptor.json');
  try {
    writeFileSync(descriptor, JSON.stringify({ port: api.address().port, token: 'fixture-only' }));
    const headers = { host: `127.0.0.1:${hqPort}`, 'x-hq-session': await session() };
    for (const [value, source] of [[digest, 'runtime-matched'], ['different', 'checkout-preview'], [undefined, 'checkout-preview']]) {
      runtimeDigest = value;
      const reply = await get('/__hq/profiles', headers);
      assert.equal(reply.status, 200);
      const profiles = JSON.parse(reply.body);
      assert.equal(profiles.source, 'runtime');
      assert.equal(profiles.defaultsSource, source);
      assert.equal(profiles.builtinManifestSha256, digest);
      assert.deepEqual(profiles.profiles.map(profile => profile.id), ['claude', 'kimi', 'codex', 'opencode', 'opencode-glm-53-flash', 'ollama', 'ollama-coder']);
      assert.equal(profiles.profiles[0].caps.lifecycle.mode, 'settingsHooks');
      if (source === 'checkout-preview') assert.match(profiles.warnings.join(' '), /not verified/);
    }
  } finally {
    writeFileSync(descriptor, JSON.stringify({ port: 1, token: 'unused' }));
    await new Promise(resolve => api.close(resolve));
  }
});

test("lesson run feedback is idempotent under concurrent HTTP retries", async () => {
  const headers = { host: `127.0.0.1:${hqPort}`, "x-hq-session": await session() };
  const added = JSON.parse((await post("/__hq/lessons", { symptom: "A repeated run posts duplicated feedback", cause: "delivery retry", fix: "bind feedback to run identity", tags: ["run-feedback"] }, headers)).body).lesson;
  const path = `/__hq/lessons/${added.id}/worked`;
  const replies = await Promise.all([post(path, { runId: "same-run" }, headers), post(path, { runId: "same-run" }, headers)]);
  for (const reply of replies) { assert.equal(reply.status, 200); assert.equal(JSON.parse(reply.body).lesson.worked, 1); }
  assert.equal((await post(`/__hq/lessons/${added.id}/failed`, { runId: "same-run" }, headers)).status, 400);
  assert.equal((await post(path, { runId: {} }, headers)).status, 400);
});

test("/__hq/lessons learns: feedback changes confidence, refine keeps history, related and brief and match answer", async () => {
  const headers = { host: `127.0.0.1:${hqPort}`, "x-hq-session": await session() };
  const base = { symptom: "Vite answers 504 Outdated Optimize Dep on every module", cause: "stale dependency cache", fix: "scripts/dev-fresh.cmd", tags: ["vite", "frontend"] };
  const sibling = { symptom: "Vite dev server serves an old bundle after a dependency bump", cause: "stale dependency cache again", fix: "rm -rf node_modules/.vite", tags: ["vite"] };
  const added = JSON.parse((await post("/__hq/lessons", base, headers)).body).lesson;
  JSON.parse((await post("/__hq/lessons", sibling, headers)).body);
  assert.equal(added.badges.label, "new");

  assert.equal((await post(`/__hq/lessons/${added.id}/worked`, {}, headers)).status, 400);
  const worked1 = JSON.parse((await post(`/__hq/lessons/${added.id}/worked`, { runId: "vite-fixture-1" }, headers)).body).lesson;
  assert.equal(worked1.badges.confidence, 100);
  const worked2 = JSON.parse((await post(`/__hq/lessons/${added.id}/worked`, { runId: "vite-fixture-2" }, headers)).body).lesson;
  assert.equal(worked2.badges.label, "proven");
  const failed = JSON.parse((await post(`/__hq/lessons/${added.id}/failed`, { runId: "vite-fixture-3" }, headers)).body).lesson;
  assert.equal(failed.badges.confidence, 67);
  assert.equal(failed.hits, 4);

  const refined = JSON.parse((await post(`/__hq/lessons/${added.id}/refine`, { fix: "scripts/dev-fresh.cmd — then restart the dev server", note: "restart was missing" }, headers)).body).lesson;
  assert.match(refined.fix, /restart/);
  assert.equal(refined.history[0].fix, base.fix);
  assert.equal((await post(`/__hq/lessons/${added.id}/refine`, { fix: "x" }, headers)).status, 400);

  const related = JSON.parse((await get(`/__hq/lessons/${added.id}/related`, headers)).body).related;
  assert.equal(related[0].symptom, sibling.symptom);

  const brief = await get("/__hq/lessons/brief?q=vite%20504", headers);
  assert.equal(brief.status, 200);
  assert.match(brief.body, /^## Known errors/);
  assert.match(brief.body, /\*\*Fix:\*\* scripts\/dev-fresh\.cmd/);
  assert.match(brief.body, /67% worked/);

  const match = JSON.parse((await post("/__hq/lessons/match", { signals: ["tests failed: 504 Outdated Optimize Dep", "waiting for human"] }, headers)).body);
  assert.equal(match.matches.length, 1);
  assert.equal(match.matches[0].lesson.id, added.id);

  const sorted = JSON.parse((await get("/__hq/lessons?sort=confidence&q=vite", headers)).body).lessons;
  assert.equal(sorted[0].id, added.id, "confidence sort puts the voted lesson first");
});

test("/__hq/insights estimates whole-project time and tokens with a stated basis and ranks live signals", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hq-insights-"));
  const repo = syntheticRepo(dir);
  const hq = spawnHq(dir, { GIT_DIR: join(repo, ".git"), GIT_WORK_TREE: repo });
  t.after(() => {
    hq.child.kill();
    rmSync(dir, { recursive: true, force: true });
  });
  const port = await hq.port;
  const headers = { host: `127.0.0.1:${port}`, "x-hq-session": await session(port) };
  const reply = await post("/__hq/insights", {
    board: [{ worker: { id: "wk-9", task: "Port the fix" }, column: "needs_you", attentionReason: "merge conflict" }],
    usage: { total: { tokensIn: 9_000_000, tokensOut: 2_000_000 }, reportedCostUsd: 4.21 },
  }, headers, port);
  assert.equal(reply.status, 200);
  const insights = JSON.parse(reply.body);
  assert.equal(insights.sittings.commits, 4, "hq-live reads the synthetic history, not this repository's");
  assert.equal(insights.sittings.count, 1);
  assert.equal(insights.effort.time.hours, 1.8, `time estimate from the synthetic history: ${insights.effort.time.hours} h`);
  assert.match(insights.effort.time.basis, /git sittings/);
  // The ledger is a floor: whichever is larger wins, and the basis says which.
  assert.ok(["ledger", "heuristic+ledger"].includes(insights.effort.tokens.source));
  assert.ok(insights.effort.tokens.value >= 11_000_000);
  assert.match(insights.effort.tokens.basis, /ledger/);
  assert.equal(insights.effort.costUsd, 4.21);
  assert.equal(insights.heat.grid.length, 7);
  assert.equal(insights.signals[0].level, "act");
  assert.match(insights.signals[0].title, /Port the fix needs a human/);
  const noLedger = JSON.parse((await post("/__hq/insights", {}, headers, port)).body);
  assert.equal(noLedger.effort.tokens.source, "heuristic");
  assert.match(noLedger.effort.tokens.basis, /2,000 changed lines × 10 tokens × 6/);
  assert.equal(noLedger.effort.tokens.value, 120_000);
});
