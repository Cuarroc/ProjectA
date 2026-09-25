#!/usr/bin/env node
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, normalize, extname, dirname, sep, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { randomBytes, createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { spawn, spawnSync } from "node:child_process";
import { runSetupChecks } from "./lib/hq-setup.mjs";
import { studioRoute } from "./lib/hq-studio.mjs";
import { activitySessions, diffVolume, estimateEffort, heatmap, significantSignals, workSessions } from "./lib/hq-insights.mjs";
import { authors, commitsPerDay, fleetStats, snapshotStats, testSurface } from "./lib/hq-stats.mjs";
import { addLesson, feedbackLesson, lessonBadges, lessonBrief, lessonStats, matchSignals, readLessonsFile, refineLesson, relatedLessons, searchLessons, touchLesson, writeLessonsFile } from "./lib/hq-lessons.mjs";
import { evaluateContinuousReadiness } from "./lib/continuous-readiness.mjs";
import {
  mergeProfileViews,
  parseBuiltinProfiles,
  readAgentsFile,
  resolveAgentsFile,
  upsertProfile,
  validateProfile,
  writeAgentsFile,
} from "./lib/hq-live-lib.mjs";

const root = process.cwd();
const docs = join(root, "docs", "dev-hq");
const port = Number(process.env.HQ_PORT || 4173);
const lessonsFile = process.env.HQ_LESSONS_FILE || join(docs, "lessons.json");
function descriptorCandidates(env = process.env) {
  const candidates = [];
  if (env.PROJECTA_API_DESCRIPTOR) return [env.PROJECTA_API_DESCRIPTOR];
  if (env.PROJECTA_APP_DATA) return [join(env.PROJECTA_APP_DATA, "projecta-api.json")];
  // Tauris app_data_dir on Windows is %APPDATA% (Roaming) — checked before
  // LOCALAPPDATA, which never holds the descriptor.
  if (env.APPDATA) candidates.push(join(env.APPDATA, "com.projecta.app", "projecta-api.json"));
  if (env.LOCALAPPDATA) candidates.push(join(env.LOCALAPPDATA, "com.projecta.app", "projecta-api.json"));
  // Tauri's app_data_dir on Linux is $XDG_DATA_HOME (falling back to
  // ~/.local/share) and on macOS ~/Library/Application Support — neither was
  // covered, so a default `npm run hq:live` on those platforms always missed
  // the descriptor even with the app running.
  const xdgDataHome = env.XDG_DATA_HOME || (env.HOME ? join(env.HOME, ".local", "share") : null);
  if (xdgDataHome) candidates.push(join(xdgDataHome, "com.projecta.app", "projecta-api.json"));
  const home = env.HOME || homedir();
  if (home) {
    candidates.push(join(home, "Library", "Application Support", "com.projecta.app", "projecta-api.json"));
  }
  return candidates;
}

// Der Server erzeugt den Snapshot beim Start neu — im Betrieb richtig, im
// Test ein Seiteneffekt auf getrackte Dateien: hq-routes/hq-security starten
// hq-live mit dem Repo als cwd, und dev-hq.mjs schreibt daraufhin
// docs/dev-hq/data.json und data.js im echten Baum. Solange `npm run test:hq`
// in keinem Gate lief, fiel das niemandem auf; seit es in den Bahnen
// `prepush` und `linux` steht, ist der Arbeitsbaum nach jedem Lauf dreckig.
// Beide Tests pruefen Routen und Absicherung, nicht die Erzeugung — sie
// setzen HQ_SKIP_SNAPSHOT und lesen den eingecheckten Snapshot.
const generator =
  process.env.HQ_SKIP_SNAPSHOT === "1"
    ? null
    : spawn(process.execPath, [join(root, "scripts", "dev-hq.mjs"), "--root", root], { stdio: "inherit" });
generator?.on("error", (error) => console.error(`HQ snapshot generation failed: ${error.message}`));

// Defends the Control API token behind this proxy against DNS rebinding: an
// attacker page that gets a victim's browser to resolve some other hostname
// to 127.0.0.1 still sends that hostname in the Host header (browsers don't
// rewrite it), so a strict allowlist here rejects the rebound request before
// the token is ever attached. The random per-process session token below is
// a second layer — it is only handed out inside the HTML this server itself
// serves, so a same-IP page loaded via a different origin can't obtain it.
const sessionToken = randomBytes(24).toString("hex");
// `port` may be 0 (pick any free port, used by tests) — allowedHost() must
// compare against the port actually bound, which server.listen()'s callback
// fills in below, not the pre-bind request value.
let boundPort = port;

function allowedHost(req) {
  const host = req.headers.host || "";
  return host === `127.0.0.1:${boundPort}` || host === `localhost:${boundPort}`;
}

function requireSession(req, res) {
  if (!allowedHost(req)) {
    sendJson(res, 403, { error: "forbidden host", code: "hq_forbidden_host" });
    return false;
  }
  const token = req.headers["x-hq-session"];
  if (typeof token !== "string" || token !== sessionToken) {
    sendJson(res, 403, { error: "missing or invalid HQ session token — reload the page", code: "hq_forbidden_session" });
    return false;
  }
  return true;
}

const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function readDescriptor() {
  // Re-resolve on every request: ProjectA may have started after the proxy.
  const candidates = descriptorCandidates();
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) {
    throw new Error(
      "ProjectA Control API is not running — start the app (npm run tauri dev), then refresh. Looked for projecta-api.json in: " +
        candidates.join(" · "),
    );
  }
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (!Number.isInteger(value.port) || typeof value.token !== "string" || !value.token) {
    throw new Error(`ProjectA API descriptor is invalid: ${path}`);
  }
  return value;
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr?.trim() || "git command failed");
  return result.stdout;
}

function analysis() {
  const files = git(["ls-files", "-z"]).split("\0").filter(Boolean);
  const source = files.filter((file) => /\.(rs|ts|tsx|js|mjs|css|html|json)$/.test(file));
  const code = source.filter((file) => /\.(rs|ts|tsx|js|mjs)$/.test(file));
  const countLines = (paths) => paths.reduce((total, file) => {
    try { return total + readFileSync(join(root, file), "utf8").split(/\r?\n/).length - 1; } catch { return total; }
  }, 0);
  const dataPath = join(docs, "data.json");
  const snapshot = existsSync(dataPath) ? JSON.parse(readFileSync(dataPath, "utf8")) : {};
  const packages = snapshot.packages || [];
  const donePackages = packages.filter((item) => item.current === "done").length;
  const remainingSpecs = (snapshot.specs || []).filter((item) => item.startable !== false).length;
  const commits = git(["log", "--since=30 days ago", "--format=%h"]).split(/\r?\n/).filter(Boolean).length;
  const estimatedHours = Math.max(remainingSpecs * 4, 2);
  return {
    generatedAt: new Date().toISOString(),
    repository: root,
    files: { tracked: files.length, source: source.length, code: code.length },
    lines: { source: countLines(source), code: countLines(code) },
    commitsLast30Days: commits,
    progress: {
      packagesDone: donePackages,
      packagesTotal: packages.length,
      percent: packages.length ? Math.round((donePackages / packages.length) * 100) : 0,
      activeSpecs: remainingSpecs,
    },
    estimate: {
      hours: estimatedHours,
      label: estimatedHours < 8 ? "under one focused day" : `${Math.ceil(estimatedHours / 8)} focused days`,
      basis: "heuristic: 4 focused hours per startable specification; excludes blocked/serial wait time",
    },
  };
}

function tryGit(args) {
  try { return git(args); } catch { return ""; }
}

function tryCommand(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 5000 });
  return result.status === 0 ? result.stdout.trim().split(/\r?\n/)[0] : null;
}

function readBody(req) {
  return new Promise((resolve) => {
    const body = [];
    req.on("data", (chunk) => body.push(chunk));
    req.on("end", () => resolve(Buffer.concat(body).toString("utf8")));
  });
}

/// Probe the Control API once (GET /api/projects) with a short timeout.
function probeApi(target) {
  return new Promise((resolve) => {
    const client = target.protocol === "https:" ? httpsRequest : httpRequest;
    const upstream = client({
      hostname: target.host || "127.0.0.1", port: target.port, path: "/api/projects", method: "GET",
      headers: { "x-projecta-token": target.token }, timeout: 2500,
    }, (reply) => { reply.resume(); resolve({ reachable: (reply.statusCode || 500) < 500, status: reply.statusCode }); });
    upstream.on("timeout", () => upstream.destroy(new Error("timeout")));
    upstream.on("error", () => resolve({ reachable: false, status: null }));
    upstream.end();
  });
}

async function setup() {
  const candidates = descriptorCandidates();
  const descriptorPath = candidates.find((candidate) => existsSync(candidate)) || null;
  let api = { reachable: false, status: null };
  if (descriptorPath) {
    try { api = await probeApi(JSON.parse(readFileSync(descriptorPath, "utf8"))); } catch { api = { reachable: false, status: null }; }
  }
  const agentsFile = resolveAgentsFile(root);
  const exeFound = ["projecta.exe", "projecta"].some((name) => existsSync(join(dirname(agentsFile), name)));
  const specs = spawnSync(process.execPath, [join(root, "scripts", "spec-status-check.mjs")], { cwd: root, encoding: "utf8", timeout: 10000 });
  const activeSpecs = /(\d+) aktiv/.exec(specs.stdout || "")?.[1];
  const chromium = process.env.HQ_CHROMIUM && existsSync(process.env.HQ_CHROMIUM)
    ? process.env.HQ_CHROMIUM
    : (process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(process.env.PLAYWRIGHT_BROWSERS_PATH) ? `playwright browsers in ${process.env.PLAYWRIGHT_BROWSERS_PATH}` : null);
  const probes = {
    nodeVersion: process.version,
    nodeModules: existsSync(join(root, "node_modules")),
    gitVersion: tryCommand("git", ["--version"]),
    hooksPath: tryGit(["config", "core.hooksPath"]).trim() || null,
    descriptorPath,
    apiReachable: api.reachable,
    apiStatus: api.status,
    agentsFile,
    exeFound,
    cargoVersion: tryCommand("cargo", ["--version"]),
    platform: process.platform,
    gtkFound: process.platform !== "linux" || spawnSync("pkg-config", ["--exists", "gdk-3.0", "webkit2gtk-4.1"]).status === 0,
    chromium,
    specsGateOk: specs.status === 0,
    specsGateError: specs.status === 0 ? null : (specs.stderr || specs.stdout || "").trim().split(/\r?\n/).pop(),
    activeSpecs: activeSpecs ? Number(activeSpecs) : 0,
    descriptorCandidates: candidates,
  };
  const checks = runSetupChecks(probes);
  let runtimeReady = false;
  try {
    const runtime = await runtimeProfilePath();
    runtimeReady = runtime.apiVersion === 1;
  } catch {
    // Keep the audit fail-closed while allowing the offline setup helper to
    // report its normal checks. It never starts the app to repair a mismatch.
  }
  const continuousReadiness = evaluateContinuousReadiness({
    setup: { setupReady: checks.ready },
    runtime: { runtimeReady },
    evidence: {
      providersAttested: false,
      runtimeAccepted: false,
      schedulerAccepted: false,
      reviewAuthorityAccepted: false,
      deliveryAccepted: false,
      recoveryAccepted: false,
      rolloutAccepted: false,
      benchmarkAccepted: false,
      continuousExecutionEnabled: false,
      stablePromotionAuthorized: false,
    },
  });
  return { generatedAt: new Date().toISOString(), probes, ...checks, continuousReadiness };
}

function stats() {
  const files = git(["ls-files", "-z"]).split("\0").filter(Boolean);
  const dataPath = join(docs, "data.json");
  const snapshot = existsSync(dataPath) ? JSON.parse(readFileSync(dataPath, "utf8")) : {};
  const rustTests = files.filter((f) => f.endsWith(".rs")).reduce((total, file) => {
    try { return total + (readFileSync(join(root, file), "utf8").match(/#\[(tokio::)?test\]/g) || []).length; } catch { return total; }
  }, 0);
  const lessons = readLessonsFile(lessonsFile);
  return {
    generatedAt: new Date().toISOString(),
    commitsPerDay: commitsPerDay(tryGit(["log", "--since=14 days ago", "--format=%ad", "--date=short"]), 14),
    commitsPerDay30: commitsPerDay(tryGit(["log", "--since=30 days ago", "--format=%ad", "--date=short"]), 30),
    authors: authors(tryGit(["shortlog", "-sn", "--since=30 days ago", "HEAD"])),
    tests: testSurface(files, rustTests),
    snapshot: snapshotStats(snapshot),
    lessons: lessonStats(lessons),
    branch: tryGit(["rev-parse", "--abbrev-ref", "HEAD"]).trim(),
    head: tryGit(["rev-parse", "--short", "HEAD"]).trim(),
    dirtyFiles: tryGit(["status", "--short"]).split(/\r?\n/).filter(Boolean).length,
  };
}

function decorate(lesson) {
  return { ...lesson, badges: lessonBadges(lesson) };
}

let insightsCache = { at: 0, value: null };
function repositoryInsights() {
  // git numstat over the whole history is the expensive part — cache 60 s.
  if (Date.now() - insightsCache.at < 60000 && insightsCache.value) return insightsCache.value;
  const timestamps = tryGit(["log", "--format=%at"]).split(/\r?\n/).filter(Boolean).map(Number);
  const git = workSessions(timestamps);
  const activityPath = join(root, ".pa", "ACTIVITY.md");
  const activity = existsSync(activityPath) ? activitySessions(readFileSync(activityPath, "utf8")) : [];
  const volume = diffVolume(tryGit(["log", "--numstat", "--format="]));
  insightsCache = { at: Date.now(), value: { timestamps, git, activity, volume, heat: heatmap(timestamps) } };
  return insightsCache.value;
}

async function insightsRoute(req, res) {
  let ctx = {};
  if (req.method === "POST") {
    try { ctx = JSON.parse((await readBody(req)) || "{}"); } catch { sendJson(res, 400, { error: "invalid JSON body" }); return; }
  }
  const repo = repositoryInsights();
  const ledger = ctx.usage?.total && Number.isFinite(ctx.usage.total.tokensIn) ? { tokensIn: ctx.usage.total.tokensIn, tokensOut: ctx.usage.total.tokensOut || 0, costUsd: ctx.usage.reportedCostUsd ?? ctx.usage.total.costUsd ?? null } : null;
  const lessons = readLessonsFile(lessonsFile);
  const dataPath = join(docs, "data.json");
  const snapshot = existsSync(dataPath) ? JSON.parse(readFileSync(dataPath, "utf8")) : {};
  const st = { commitsPerDay: commitsPerDay(tryGit(["log", "--since=14 days ago", "--format=%ad", "--date=short"]), 14) };
  const dirtyFiles = tryGit(["status", "--short"]).split(/\r?\n/).filter(Boolean).length;
  const effort = estimateEffort({ git: repo.git, activity: repo.activity, volume: repo.volume, ledger });
  sendJson(res, 200, {
    generatedAt: new Date().toISOString(),
    effort,
    sittings: { count: repo.git.sessions.length, hours: repo.git.hours, commits: repo.git.commits, journalSessions: repo.activity.length, instances: [...new Set(repo.activity.map((a) => a.instance))].length },
    volume: repo.volume,
    heat: repo.heat,
    firstCommit: repo.timestamps.length ? Math.min(...repo.timestamps) : null,
    lastCommit: repo.timestamps.length ? Math.max(...repo.timestamps) : null,
    signals: significantSignals({ ...ctx, lessons, snapshot: snapshotStats(snapshot), stats: st, dirtyFiles }),
  });
}

async function lessonsRoute(req, res, url) {
  const lessons = readLessonsFile(lessonsFile);
  const action = /^\/__hq\/lessons\/([A-Za-z0-9-]+)\/(hit|worked|failed|refine|related)$/.exec(url.pathname);
  if (action) {
    const [, id, verb] = action;
    const current = lessons.find((l) => l.id === id);
    if (!current) { sendJson(res, 404, { error: "unknown lesson" }); return; }
    if (verb === "related") {
      sendJson(res, 200, { related: relatedLessons(lessons, id, Number(url.searchParams.get("limit") || 3)).map(decorate) });
      return;
    }
    if (req.method !== "POST") { sendJson(res, 405, { error: "method not allowed" }); return; }
    let next;
    if (verb === "hit") next = touchLesson(lessons, id);
    else if (verb === "worked" || verb === "failed") {
      try {
        const feedback = JSON.parse((await readBody(req)) || "{}");
        // Read after the asynchronous body boundary so concurrent HTTP feedback
        // observes the previous synchronous write before applying its outcome.
        next = feedbackLesson(readLessonsFile(lessonsFile), id, verb, undefined, feedback.runId);
      } catch (error) { sendJson(res, 400, { error: error.message, code: "hq_lesson_invalid" }); return; }
    }
    else {
      let update;
      try { update = JSON.parse((await readBody(req)) || "{}"); } catch { sendJson(res, 400, { error: "invalid JSON body" }); return; }
      try { next = refineLesson(lessons, id, update); } catch (error) { sendJson(res, 400, { error: error.message, code: "hq_lesson_invalid" }); return; }
    }
    writeLessonsFile(lessonsFile, next);
    sendJson(res, 200, { ok: true, lesson: decorate(next.find((l) => l.id === id)) });
    return;
  }
  if (url.pathname === "/__hq/lessons/brief") {
    const q = url.searchParams.get("q") || "";
    const text = lessonBrief(lessons, q, Number(url.searchParams.get("limit") || 5));
    res.writeHead(200, { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" });
    res.end(text);
    return;
  }
  if (url.pathname === "/__hq/lessons/match" && req.method === "POST") {
    let body;
    try { body = JSON.parse((await readBody(req)) || "{}"); } catch { sendJson(res, 400, { error: "invalid JSON body" }); return; }
    const signals = Array.isArray(body.signals) ? body.signals.map(String).slice(0, 50) : [];
    sendJson(res, 200, { matches: matchSignals(lessons, signals).map((m) => ({ signal: m.signal, lesson: decorate(m.lesson) })) });
    return;
  }
  if (url.pathname !== "/__hq/lessons") { sendJson(res, 404, { error: "not found" }); return; }
  if (req.method === "GET") {
    const q = url.searchParams.get("q") || "";
    const sort = url.searchParams.get("sort") || "relevance";
    let found = searchLessons(lessons, q, Number(url.searchParams.get("limit") || 20));
    if (sort === "hits") found = [...found].sort((a, b) => (b.hits || 0) - (a.hits || 0));
    else if (sort === "recent") found = [...found].sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)));
    else if (sort === "confidence") found = [...found].sort((a, b) => (lessonBadges(b).confidence ?? -1) - (lessonBadges(a).confidence ?? -1));
    sendJson(res, 200, { file: lessonsFile, query: q, sort, stats: lessonStats(lessons), lessons: found.map(decorate) });
    return;
  }
  if (req.method === "POST") {
    let input;
    try { input = JSON.parse((await readBody(req)) || "{}"); } catch { sendJson(res, 400, { error: "invalid JSON body" }); return; }
    try {
      const result = addLesson(lessons, input);
      writeLessonsFile(lessonsFile, result.lessons);
      sendJson(res, 200, { ok: true, merged: result.merged, lesson: decorate(result.lesson) });
    } catch (error) {
      sendJson(res, 400, { error: error.message, code: "hq_lesson_invalid" });
    }
    return;
  }
  sendJson(res, 405, { error: "method not allowed" });
}

function proxy(req, res, apiPath) {
  let target;
  try { target = readDescriptor(); } catch (error) {
    sendJson(res, 503, { error: error.message, code: "hq_api_unavailable" });
    return;
  }
  const body = [];
  req.on("data", (chunk) => body.push(chunk));
  req.on("end", () => {
    const headers = {
      "x-projecta-token": target.token,
      "content-type": req.headers["content-type"] || "application/json",
      "content-length": Buffer.concat(body).length,
    };
    const verdict = req.headers["x-hq-verdict-token"];
    if (typeof verdict === "string" && verdict) headers["x-verdict-token"] = verdict;
    const client = target.protocol === "https:" ? httpsRequest : httpRequest;
    const upstream = client({
      hostname: target.host || "127.0.0.1",
      port: target.port,
      path: apiPath,
      method: req.method,
      headers,
      timeout: 8000,
    }, (reply) => {
      res.writeHead(reply.statusCode || 502, {
        "content-type": reply.headers["content-type"] || "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      reply.pipe(res);
    });
    upstream.on("timeout", () => upstream.destroy(new Error("Control API timed out")));
    upstream.on("error", (error) => {
      if (!res.headersSent) sendJson(res, 503, { error: error.message, code: "hq_api_unavailable" });
      else res.destroy(error);
    });
    if (body.length) upstream.write(Buffer.concat(body));
    upstream.end();
  });
}

function serveFile(req, res) {
  if (!allowedHost(req)) {
    sendJson(res, 403, { error: "forbidden host", code: "hq_forbidden_host" });
    return;
  }
  const requested = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const file = normalize(join(docs, requested));
  const staticRoot = normalize(docs);
  // Compare with the platform separator, not a hardcoded "\\": on Linux/macOS
  // normalize() never inserts backslashes, so appending "\\" here rejected
  // every request and made `npm run hq:live` 404 on non-Windows checkouts.
  if ((file !== staticRoot && !file.startsWith(staticRoot + sep)) || !existsSync(file) || !statSync(file).isFile()) {
    sendJson(res, 404, { error: "not found" });
    return;
  }
  const contentType = mime[extname(file)] || "application/octet-stream";
  if (extname(file) === ".html") {
    const html = readFileSync(file, "utf8").replace(
      "<head>",
      `<head>\n  <meta name="hq-session" content="${sessionToken}">`,
    );
    res.writeHead(200, { "content-type": contentType, "cache-control": "no-store" });
    res.end(html);
    return;
  }
  res.writeHead(200, { "content-type": contentType, "cache-control": "no-store" });
  res.end(readFileSync(file));
}

const builtinProfilesFile = join(root, "src-tauri", "resources", "agent-defaults.json");

function runtimeProfilePath() {
  return new Promise((resolve, reject) => {
    let target;
    try { target = readDescriptor(); } catch (error) { reject(error); return; }
    const client = target.protocol === "https:" ? httpsRequest : httpRequest;
    const request = client({ hostname: target.host || "127.0.0.1", port: target.port,
      path: "/api/hq/v1/runtime", method: "GET", timeout: 2000,
      headers: { "x-projecta-token": target.token } }, (reply) => {
      const chunks = [];
      let size = 0;
      reply.on("data", chunk => { size += chunk.length; if (size > 1024 * 1024) request.destroy(new Error("runtime response too large")); else chunks.push(chunk); });
      reply.on("error", reject);
      reply.on("end", () => {
        try {
          if (reply.statusCode !== 200) throw new Error("running app does not expose the HQ v1 runtime contract");
          const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (value.apiVersion !== 1 || typeof value.profilesPath !== "string" || !isAbsolute(value.profilesPath)) throw new Error("runtime profile path is unavailable");
          resolve(value);
        } catch (error) { reject(error); }
      });
    });
    request.on("timeout", () => request.destroy(new Error("runtime profile lookup timed out")));
    request.on("error", reject);
    request.end();
  });
}

async function profileLocation() {
  try {
    const runtime = await runtimeProfilePath();
    return { agentsFile: runtime.profilesPath, source: "runtime", writable: true, warnings: runtime.warnings || [], runtimeBuiltinManifestSha256: runtime.provenance?.builtinManifestSha256 ?? null };
  } catch (error) {
    const explicit = process.env.PROJECTA_AGENTS_FILE;
    if (explicit && !isAbsolute(explicit)) throw new Error("PROJECTA_AGENTS_FILE must be an absolute file path");
    return { agentsFile: explicit || resolveAgentsFile(root), source: explicit ? "explicit-offline" : "checkout-preview",
      writable: Boolean(explicit), warnings: [error.message, "Active runtime configuration is not verified."] };
  }
}

async function listProfiles() {
  const location = await profileLocation();
  const { agentsFile } = location;
  let builtins = [];
  let defaultsSource = "unavailable";
  let builtinManifestSha256 = null;
  try {
    const raw = readFileSync(builtinProfilesFile, "utf8");
    builtins = parseBuiltinProfiles(raw);
    builtinManifestSha256 = createHash('sha256').update(raw.replace(/\r\n/g, '\n')).digest('hex');
    defaultsSource = location.source === 'runtime' && location.runtimeBuiltinManifestSha256 === builtinManifestSha256 ? 'runtime-matched' : 'checkout-preview';
    if (defaultsSource !== 'runtime-matched') location.warnings.push('Built-in defaults are a checkout preview; matching compiled runtime defaults are not verified.');
  } catch (error) {
    location.writable = false;
    location.warnings.push(`Built-in profile manifest unavailable: ${error.message}`);
  }
  let overrides = { profiles: [] };
  try { overrides = readAgentsFile(agentsFile, { strict: true }); }
  catch (error) { location.writable = false; location.warnings.push(error.message); }
  // An override file is only read by an exe sitting in the same directory.
  // If no exe exists there (e.g. the app runs from another checkout), profiles
  // saved here would silently never load — say so instead.
  const exeDir = dirname(agentsFile);
  const exeExists = ["projecta.exe", "projecta"].some((name) => existsSync(join(exeDir, name)));
  return {
    ...location,
    defaultsSource,
    builtinManifestSha256,
    agentsFile,
    profiles: mergeProfileViews(builtins, overrides),
    exeFound: exeExists,
    note: location.source === "runtime"
      ? `Runtime-reported profile path. Changes apply on the next spawn. ${location.warnings.join(" ")}`
      : `Offline preview; runtime path unverified. ${location.writable ? "Explicit file edits are available." : "Saving is disabled until the app reports its path or PROJECTA_AGENTS_FILE is set."} ${location.warnings.join(" ")}`,
  };
}

function saveProfile(req, res) {
  const body = [];
  req.on("data", (chunk) => body.push(chunk));
  req.on("end", async () => {
    let profile;
    try { profile = JSON.parse(Buffer.concat(body).toString("utf8") || "{}"); } catch {
      sendJson(res, 400, { error: "invalid JSON body" });
      return;
    }
    const invalid = validateProfile(profile);
    if (invalid) {
      sendJson(res, 400, { error: invalid, code: "hq_profile_invalid" });
      return;
    }
    try {
      const { agentsFile, writable } = await profileLocation();
      if (!writable) { sendJson(res, 409, { error: "Profile path is an unverified preview; start the compatible app or set PROJECTA_AGENTS_FILE explicitly." }); return; }
      const doc = upsertProfile(readAgentsFile(agentsFile, { strict: true }), profile);
      writeAgentsFile(agentsFile, doc);
      sendJson(res, 200, { ok: true, agentsFile, profile: doc.profiles.find((p) => p.id === profile.id) });
    } catch (error) {
      sendJson(res, 500, { error: error.message, code: "hq_profile_write_failed" });
    }
  });
}

const server = createServer((req, res) => {
  if (req.url.startsWith("/__hq/") && !requireSession(req, res)) return;
  if (req.url.startsWith('/__hq/studio/')) {
    studioRoute(req, res, root, sendJson).then(handled => { if (!handled) sendJson(res, 404, { error: 'not found' }); }).catch(error => sendJson(res, 500, { error: error.message }));
    return;
  }
  if (req.url === "/__hq/profiles") {
    if (req.method === "GET") {
      listProfiles().then(value => sendJson(res, 200, value)).catch(error => sendJson(res, 500, { error: error.message }));
    } else if (req.method === "POST") {
      saveProfile(req, res);
    } else {
      sendJson(res, 405, { error: "method not allowed" });
    }
    return;
  }
  if (req.url === "/__hq/setup") {
    setup().then((result) => sendJson(res, 200, result)).catch((error) => sendJson(res, 500, { error: error.message, code: "hq_setup_failed" }));
    return;
  }
  if (req.url === "/__hq/stats") {
    try { sendJson(res, 200, stats()); } catch (error) { sendJson(res, 500, { error: error.message, code: "hq_stats_failed" }); }
    return;
  }
  if (req.url === "/__hq/insights") {
    insightsRoute(req, res).catch((error) => sendJson(res, 500, { error: error.message, code: "hq_insights_failed" }));
    return;
  }
  if (req.url.startsWith("/__hq/lessons")) {
    lessonsRoute(req, res, new URL(req.url, "http://127.0.0.1")).catch((error) => sendJson(res, 500, { error: error.message }));
    return;
  }
  if (req.url === "/__hq/analysis") {
    try { sendJson(res, 200, analysis()); } catch (error) { sendJson(res, 500, { error: error.message, code: "hq_analysis_failed" }); }
    return;
  }
  if (req.url.startsWith("/__hq/api/")) {
    proxy(req, res, req.url.slice("/__hq".length));
    return;
  }
  serveFile(req, res);
});

server.listen(port, "127.0.0.1", () => {
  boundPort = server.address().port;
  console.log(`Dev HQ live mode: http://127.0.0.1:${boundPort}/live.html`);
  console.log(`Control API descriptor candidates: ${descriptorCandidates().join(" | ")}`);
});
