import test from "node:test";
import assert from "node:assert/strict";
import { buildRoadmap } from "./roadmap-data.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeRunner } from "./dev-tools.mjs";
import { main } from "../roadmap-data.mjs";

const now = "2026-10-15T12:00:00Z", day = 86400000;
const row = (id = "APP-1", extra = {}) => ({ id, title: "Search", status: "planned", statusRaw: "Geplant", deps: [], ...extra });
const pr = (extra = {}) => ({ number: 1, state: "OPEN", body: "Plan-ID: APP-1", headRefName: "codex/app-1", labels: [], isDraft: false, ...extra });
const check = (conclusion, isRequired = true) => ({ conclusion, isRequired });
const build = (packages, prs = [], extra = {}) => buildRoadmap({ plan: { packages, decisions: [] }, prs, releases: [], now, mainSha: "abc1234", ...extra });
const state = (p, extra = {}) => build([row("APP-1", extra)], [p]).packages[0].state;

test("merged wins over error and human signals", () => {
  assert.equal(state(pr({ state: "MERGED", mergedAt: now, labels: [{ name: "conflict" }, { name: "do-not-merge" }] }), { owner: "Nutzer" }), "Erledigt");
});
test("conflicts and red required checks win over human and ready signals", () => {
  assert.equal(state(pr({ labels: [{ name: "conflict" }, { name: "review-ok" }] }), { owner: "Nutzer" }), "Fehler");
  assert.equal(state(pr({ statusCheckRollup: [check("FAILURE")] }), { owner: "Nutzer" }), "Fehler");
});
test("human ownership and holds win over green ready", () => {
  assert.equal(state(pr({ labels: [{ name: "do-not-merge" }, { name: "review-ok" }], statusCheckRollup: [check("SUCCESS")] })), "Braucht dich");
  assert.equal(state(pr(), { owner: "Nutzer" }), "Braucht dich");
});
test("ready needs green required checks and review approval", () => {
  assert.equal(state(pr({ labels: [{ name: "review-ok" }], statusCheckRollup: [check("SUCCESS"), check("FAILURE", false)] })), "Bereit zum Mergen");
  assert.equal(state(pr({ labels: [{ name: "review-ok" }], statusCheckRollup: [] })), null);
});
test("pending ready checks mean in review", () => {
  assert.equal(state(pr({ labels: [{ name: "review-ok" }], statusCheckRollup: [{ isRequired: true, status: "IN_PROGRESS", conclusion: "" }] })), "In Prüfung");
});
test("draft activity requires a recent commit rather than updatedAt", () => {
  assert.equal(state(pr({ isDraft: true, commits: [{ committedDate: "2026-10-13T12:00:01Z" }] })), "Läuft");
  assert.equal(state(pr({ isDraft: true, commits: [{ committedDate: "2026-10-13T12:00:00Z" }], updatedAt: now })), null);
  assert.equal(state(pr({ isDraft: true, updatedAt: now })), null);
});
test("no PR keeps PLAN claims separate from observed state", () => {
  const p = build([row("APP-1", { status: "in_progress", statusRaw: "In Arbeit" })]).packages[0];
  assert.equal(p.state, null);
  assert.equal(p.planStatus, "laut PLAN: In Arbeit");
});
test("identity matching is exact and explicit Plan-ID takes priority", () => {
  const result = build([row(), row("APP-10")], [pr({ body: "Plan-ID: APP-10", headRefName: "codex/app-1-fix", state: "MERGED", mergedAt: now })]);
  assert.deepEqual(result.packages.map(p => p.state), [null, "Erledigt"]);
  assert.equal(state(pr({ body: "", headRefName: "codex/app-1-fix", isDraft: true, commits: [{ committedDate: now }] })), "Läuft");
  assert.equal(state(pr({ state: "CLOSED", labels: [{ name: "conflict" }] })), null);
});
test("forecast needs ten distinct recent merges and excludes seam paths", () => {
  const packages = Array.from({ length: 11 }, (_, i) => row(`APP-${i + 1}`));
  const prs = Array.from({ length: 10 }, (_, i) => pr({ number: i + 1, body: `Plan-ID: APP-${i + 1}`, state: "MERGED", mergedAt: new Date(Date.parse(now) - (i % 7 + 0.5) * day).toISOString() }));
  assert.equal(build(packages, prs.slice(1)).directions[0].forecast, "zu wenig Daten");
  assert.deepEqual(build(packages, prs).directions[0].forecast, { fromDays: 1, toDays: 1, label: "Prognose, keine Zusage", merged: 10, dailyMerges: [2, 2, 2, 1, 1, 1, 1] });
  assert.equal(build(packages, [...prs.slice(1), { ...prs[1], number: 99 }]).directions[0].forecast, "zu wenig Daten");
  packages[10].deps = ["CORE-1"];
  packages.push(row("CORE-1", { title: "Change src-tauri/src/api.rs" }));
  assert.equal(build(packages, prs).directions[0].forecast, "zu wenig Daten");
  prs[0].mergedAt = "2026-10-08T11:59:59Z";
  assert.equal(build(packages.slice(0, 11), prs).directions[0].forecast, "zu wenig Daten");
});
test("head and lanes derive from plan dependencies releases and decisions", () => {
  const plan = `## Work\n| ID | Ziel | Owner | Hängt ab von | Status | Version | Richtung |\n|---|---|---|---|---|---|---|\n| APP-1 | Search | Nutzer | – | Geplant | v2.0.0 | App |\n| APP-2 | Index | Root | APP-1 | Blockiert | v2.1.0 | App |\n| APP-3 | Help | Worker | – | Geplant | v1.6.6 | App |\n\n## Entscheidungs-Inbox\n| # | Frage | Status |\n|---|---|---|\n| E1 | Choose | offen |\n\n## Entscheidungs-Inbox (historisch)\n| # | Frage | Status |\n|---|---|---|\n| E2 | Old | offen |`;
  const r = build([], [pr()], { plan, releases: [{ tagName: "v1.6.6", isDraft: false, isPrerelease: false }] });
  assert.deepEqual(r.head, { nextVersion: "v2.0.0", open: 1, yourSteps: 2, blockers: 1 });
  assert.deepEqual(r.stand, { generatedAt: "2026-10-15T12:00:00.000Z", mainSha: "abc1234" });
  assert.deepEqual(r.directions[0].now, ["APP-1"]);
  assert.deepEqual(r.directions[0].next, ["APP-3"]);
  assert.deepEqual(r.directions[0].later, ["APP-2"]);
  assert.equal(r.haengt.find(p => p.id === "APP-2").who, "Root");
  assert.equal(build([row()], [pr(), pr({ number: 2, body: "Plan-ID: OTHER-1", headRefName: "codex/other-1" }), pr({ number: 3, body: "", headRefName: "mergify/queue-1" })]).head.open, 2);
});
test("public projection never copies PR bodies owners or private metadata", () => {
  const r = build([row("APP-1", { owner: "Worker at build.private.invalid", title: "Search", costs: 42, quota: 80 })], [pr({ body: "Plan-ID: APP-1\nserver: build.private.invalid\ncosts: 42 quota: 80", isDraft: true, commits: [{ committedDate: now }] })]);
  assert.equal(r.packages[0].title, "Search");
  assert.doesNotMatch(JSON.stringify(r), /private\.invalid|costs|quota|42|80/);
  assert.equal(build([row("APP-1", { title: "Move host build.private.invalid" })]).packages[0].title, "Unbekannt");
});
test("CLI separates historical merges from live checks and fails closed offline", async () => {
  const calls = [], out = [], errors = [];
  const run = (cmd, args) => {
    calls.push([cmd, ...args]);
    const data = args[0] === "release" ? [] : args[0] === "pr" && args[1] === "list" ? [pr({ state: args.includes("merged") ? "MERGED" : "OPEN", baseRefName: "main", mergedAt: now })] : args[1] === "view" ? { commits: [{ committedDate: now }] } : [];
    return { code: 0, stdout: cmd === "git" ? (args[0] === "show" ? "| ID | Ziel | Status |\n|---|---|---|\n| APP-1 | Search | Geplant |" : "abc1234") : JSON.stringify(data) };
  };
  const io = { out: s => out.push(s), err: s => errors.push(s) };
  assert.equal(await main(["--stdout"], io, { run, now }), 0);
  assert.equal(JSON.parse(out[0]).head.open, 1);
  assert.ok(calls.some(c => c.includes("is:open") && c.includes("all")));
  assert.ok(calls.some(c => c.includes("merged") && !c.some(a => a.includes("statusCheckRollup"))));
  assert.equal(await main(["--stdout"], io, { run: () => ({ code: 1, stdout: "", stderr: "private.invalid" }), now }), 1);
  assert.doesNotMatch(errors.join(""), /private.invalid/);
});
test("CLI reads PLAN and mainSha from the same origin/main commit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "roadmap-"));
  try {
    const real = makeRunner();
    const git = (...a) => assert.equal(real("git", ["-C", dir, ...a]).code, 0);
    const table = id => `| ID | Ziel | Status |\n|---|---|---|\n| ${id} | Search | Geplant |`;
    git("init", "-q");
    mkdirSync(join(dir, "docs"));
    writeFileSync(join(dir, "docs/PLAN.md"), table("APP-1"));
    git("add", ".");
    git("-c", "user.name=t", "-c", "user.email=t@users.noreply.github.com", "commit", "-q", "-m", "plan");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    writeFileSync(join(dir, "docs/PLAN.md"), table("APP-2")); // working tree drifts from origin/main
    const run = (cmd, args) => cmd === "git" ? real(cmd, ["-C", dir, ...args]) : { code: 0, stdout: "[]" };
    const sha = real("git", ["-C", dir, "rev-parse", "origin/main"]).stdout.trim(), out = [];
    const read = () => table("APP-2");
    assert.equal(await main(["--stdout"], { out: s => out.push(s), err: () => {} }, { run, now }), 0);
    const data = JSON.parse(out[0]);
    assert.deepEqual(data.packages.map(p => p.id), ["APP-1"]);
    assert.equal(data.stand.mainSha, sha);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("required checks skip non-main bases and name the PR on garbled output", async () => {
  const mk = (prs, checks) => (cmd, args) => {
    if (cmd === "git") return { code: 0, stdout: args[0] === "show" ? "| ID | Ziel | Status |\n|---|---|---|\n| APP-1 | Search | Geplant |" : "abc1234" };
    if (args[1] === "checks") return checks;
    const data = args[0] === "release" ? [] : args[1] === "list" ? (args.includes("merged") ? [] : prs) : { commits: [] };
    return { code: 0, stdout: JSON.stringify(data) };
  };
  const io = errors => ({ out: () => {}, err: s => errors.push(s) });
  const read = () => "";
  const stacked = pr({ number: 7, baseRefName: "codex/other" }), errors = [];
  assert.equal(await main(["--stdout"], io(errors), { run: mk([stacked], { code: 1, stdout: "" }), read, now }), 0);
  const direct = pr({ number: 8, baseRefName: "main" });
  assert.equal(await main(["--stdout"], io(errors), { run: mk([direct], { code: 1, stdout: "not json" }), read, now }), 1);
  assert.match(errors.join(""), /#8/);
});
