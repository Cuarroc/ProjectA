// SETUP-08b: hygiene checks, fed with fixed inputs (no network, no gh).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { collectHygiene, countFindings, formatHygiene, inProgressPackages, activeSpecIds, gather, main } from "../dev/hygiene.mjs";

const root = resolve(import.meta.dirname, "../..");
const NOW = Date.parse("2026-09-25T12:00:00Z");

const MASTERPLAN = [
  "## S0 — in Arbeit",
  "",
  "| ID | Titel | Gr. | Status | Abhängig von | Lane / Dateien | Parallel-Gruppe | Modell | Quelle |",
  "|---|---|---|---|---|---|---|---|---|",
  "| W2-05 | Discovery | M | in Arbeit PR #107 (eigene Datei) | W2-04 ✓ | st | st/S0 | O·h | P |",
  "| W1-22 | tauri-plugin-log | S | in Arbeit (Worker läuft, noch kein PR) | W1-15 ✓ | mn | mn/S0 | O·h | P |",
  "| SETUP-B | Dev-Skripte | 2 × M | in Arbeit | — | scripts/dev | doc/S1 | O·h | Setup |",
  "| W2-08 | Druck | M | offen | — | fR | fR/S1 | Cx·m | P |",
  "",
  "| Neu-ID | Inhalt | Gr. | Lane | Quelle |",
  "|---|---|---|---|---|",
  "| W2-01b | Review-Route | S | api | R |",
  "",
].join("\n");

const STAND = [
  "## Aktive Specs",
  "",
  "- `.pa/task_devflow.md`: DEVFLOW.",
  "",
  "| Spec | Paket | Lane |",
  "|---|---|---|",
  "| `.pa/task_w1-05.md` | W1-05b: Queue-Abnahmerest | parallel |",
  "| `.pa/task_w1-22.md` | W1-22: tauri-plugin-log | seriell |",
  "",
  "## Danach",
].join("\n");

const ERLEDIGT = "| Datum | ID | Titel | PR | Merge-SHA | Report |\n|---|---|---|---|---|---|\n| 24.09. | W1-05 | Doku | [#40](x) | abc | — |\n";

const input = {
  now: NOW,
  prsOpen: [
    { number: 107, title: "W2-05 Discovery", headRefName: "claude/w2-05-discovery", updatedAt: "2026-09-24T01:00:00Z", isDraft: false },
    { number: 125, title: "SETUP-B", headRefName: "claude/setup-b-dev-scripts", updatedAt: "2026-09-25T11:00:00Z", isDraft: true },
    { number: 120, title: "merge queue: checking #112", headRefName: "mergify/merge-queue/abc", updatedAt: "2026-09-20T00:00:00Z", isDraft: true },
  ],
  prsAll: [
    { number: 107, headRefName: "claude/w2-05-discovery", state: "OPEN", title: "W2-05" },
    { number: 125, headRefName: "claude/setup-b-dev-scripts", state: "OPEN", title: "SETUP-B" },
    { number: 130, headRefName: "claude/w1-22-plugin-log", state: "MERGED", title: "W1-22 tauri-plugin-log" },
    { number: 40, headRefName: "claude/w1-05-docs", state: "MERGED", title: "W1-05 Doku" },
  ],
  remoteBranches: [
    { name: "main", merged: true },
    { name: "claude/w2-05-discovery", merged: false },
    { name: "claude/old-merged", merged: true },
    { name: "kimi/lost-work", merged: false },
    { name: "mergify/merge-queue/abc", merged: false },
  ],
  standText: STAND,
  planText: MASTERPLAN,
  erledigtText: ERLEDIGT,
  untracked: ["MEMORY.md", "$OUT"],
};

test("inProgressPackages reads the Status column of every MASTERPLAN table", () => {
  const rows = inProgressPackages(MASTERPLAN);
  assert.deepEqual(rows.map((r) => r.id), ["W2-05", "W1-22", "SETUP-B"]);
  assert.deepEqual(rows[0].prNumbers, [107]);
});

test("inProgressPackages reads the Stand column of the milestone tables in docs/PLAN.md", () => {
  const plan = [
    "### M1 — Alles Laufende gelandet",
    "",
    "| ID | Paket | Gr. | Lane | Stand |",
    "|---|---|---|---|---|",
    "| W1-05b | Cancel-Regel | M | st → api | ✓ #19 |",
    "| W1-03e | MSG_USER erst nach Zustellung | S | wk | PR #171 |",
    "| W1-20 | Zweites Setup | S | N | PR #166, in Review |",
    "| CI-02 | Leichter main-Push | S | ci | offen |",
    "| W2-10 | Live-HQ-Views | M | hqL | 10a ✓ #13, 10c offen |",
    "",
  ].join("\n");
  const rows = inProgressPackages(plan);
  assert.deepEqual(rows.map((r) => r.id), ["W1-03e", "W1-20"]);
  assert.deepEqual(rows.map((r) => r.prNumbers), [[171], [166]]);
});

function assertInProgressRows(rows) {
  for (const r of rows) {
    assert.match(r.status, /^(?:in Arbeit|PR #\d|Drafts? #\d|Ready #\d)/i);
    assert.match(r.id, /^[A-Z]/);
  }
}

test("inProgressPackages parses the real docs/PLAN.md", () => {
  assertInProgressRows(inProgressPackages(readFileSync(join(root, "docs/PLAN.md"), "utf8")));
});

test("inProgressPackages accepts a milestone table with no running rows", () => {
  const plan = [
    "### M1 — Alles Laufende gelandet",
    "",
    "| ID | Paket | Gr. | Lane | Stand |",
    "|---|---|---|---|---|",
    "| W1-05b | Cancel-Regel | M | st → api | ✓ #19 |",
    "| CI-02 | Leichter main-Push | S | ci | offen |",
    "",
  ].join("\n");
  const rows = inProgressPackages(plan);
  assert.deepEqual(rows, []);
  assertInProgressRows(rows);
});

test("the in-progress row validator still rejects malformed rows", () => {
  assert.throws(() => assertInProgressRows([{ id: "W1-01", status: "offen" }]));
  assert.throws(() => assertInProgressRows([{ id: "w1-01", status: "in Arbeit" }]));
});

test("activeSpecIds prefers the package column over the file name", () => {
  const ids = activeSpecIds(STAND);
  assert.deepEqual(ids, [
    { spec: "task_devflow.md", ids: ["devflow"] },
    { spec: "task_w1-05.md", ids: ["W1-05b"] },
    { spec: "task_w1-22.md", ids: ["W1-22"] },
  ]);
});

test("hygiene finds all five kinds of findings", () => {
  const f = collectHygiene(input);
  assert.deepEqual(f.stalePrs.map((p) => p.number), [107]);
  assert.deepEqual(f.branchesWithoutPr.map((b) => b.name), ["claude/old-merged", "kimi/lost-work"]);
  assert.deepEqual(f.specsOfMergedPrs.map((s) => [s.spec, s.id, s.pr]), [["task_w1-22.md", "W1-22", 130]]);
  assert.deepEqual(f.inProgressWithoutPr.map((r) => r.id), ["W1-22"]);
  assert.deepEqual(f.untracked, ["MEMORY.md", "$OUT"]);
});

test("hygiene does not match an ID as a prefix of a longer ID", () => {
  const f = collectHygiene({ ...input, prsAll: [...input.prsAll, { number: 131, headRefName: "claude/w1-05b-cancel", state: "MERGED", title: "W1-05b" }] });
  assert.deepEqual(f.specsOfMergedPrs.map((s) => s.id).sort(), ["W1-05b", "W1-22"]);
  const g = collectHygiene({ ...input, prsAll: [...input.prsAll, { number: 132, headRefName: "claude/w1-22b-more", state: "MERGED", title: "W1-22b" }] });
  assert.deepEqual(g.specsOfMergedPrs.map((s) => s.pr), [130]);
});

test("hygiene renders markdown with one section per check", () => {
  const md = formatHygiene(collectHygiene(input));
  for (const h of ["Offene PRs ohne Aktivität", "Branches ohne PR", "Aktive Specs zu gemergten PRs", "„in Arbeit“ ohne offenen PR", "Ungetrackte Dateien im Hauptcheckout"]) {
    assert.ok(md.includes(h), h);
  }
  assert.match(md, /#107/);
  assert.match(md, /kimi\/lost-work/);
});

test("gather reads git and gh read-only and hygiene --strict exits 1 on findings", async () => {
  const calls = [];
  const fake = (cmd, args) => {
    calls.push([cmd, ...args]);
    const a = args.join(" ");
    if (cmd === "gh" && a.includes("--state open")) return { code: 0, stdout: JSON.stringify(input.prsOpen), stderr: "" };
    if (cmd === "gh" && a.includes("--state all")) return { code: 0, stdout: JSON.stringify(input.prsAll), stderr: "" };
    if (a.includes("worktree list")) return { code: 0, stdout: `worktree ${root}\nHEAD abc\nbranch refs/heads/main\n\n`, stderr: "" };
    if (a.includes("for-each-ref")) return { code: 0, stdout: "origin/main\norigin/HEAD\norigin/kimi/lost-work\n", stderr: "" };
    if (a.includes("merge-base")) return { code: 1, stdout: "", stderr: "" };
    if (a.includes("status")) return { code: 0, stdout: "?? MEMORY.md\n?? $OUT\n M tracked.txt\n", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  const data = gather({ run: fake, cwd: root, now: NOW });
  assert.deepEqual(data.remoteBranches.map((b) => b.name), ["main", "kimi/lost-work"]);
  assert.deepEqual(data.untracked, ["MEMORY.md", "$OUT"]);
  for (const c of calls) {
    const a = c.join(" ");
    assert.doesNotMatch(a, /\b(push|commit|checkout|reset|merge --|worktree remove|branch -d|pr (create|edit|merge))\b/);
  }
  const out = [];
  const io = { out: (s) => out.push(s), err: (s) => out.push(s) };
  assert.equal(await main(["--no-fetch"], io, { run: fake, now: () => NOW }), 0);
  assert.equal(await main(["--no-fetch", "--strict"], io, { run: fake, now: () => NOW }), 1);
  assert.match(out.join(""), /# Hygiene/);
});

test("hygiene --help exits 0", async () => {
  const out = [];
  assert.equal(await main(["--help"], { out: (s) => out.push(s), err: (s) => out.push(s) }), 0);
  assert.match(out.join(""), /hygiene/);
});

// --- Review SETUP-08b (glm-5.2 #1, #3, #6; kimi-k3 #2, #3, #5, #6, #7) ---

function fakeRun(over = {}) {
  return (cmd, args) => {
    let rest = args;
    // git: drop global "-C <path>" / "-c <key=value>" so only the subcommand and its args are matched.
    if (cmd === "git") while (rest[0] === "-C" || rest[0] === "-c") rest = rest.slice(2);
    const a = rest.join(" ");
    for (const [needle, res] of Object.entries(over)) if (cmd === "git" ? a.startsWith(needle) : a.includes(needle)) return typeof res === "function" ? res(cmd, args) : res;
    if (cmd === "gh" && a.includes("--state open")) return { code: 0, stdout: JSON.stringify(input.prsOpen), stderr: "" };
    if (cmd === "gh" && a.includes("--state all")) return { code: 0, stdout: JSON.stringify(input.prsAll), stderr: "" };
    if (a.startsWith("rev-parse")) return { code: 0, stdout: `${root}\n`, stderr: "" };
    if (a.startsWith("worktree list")) return { code: 0, stdout: `worktree ${root}\nHEAD abc\nbranch refs/heads/main\n\n`, stderr: "" };
    if (a.startsWith("for-each-ref")) return { code: 0, stdout: "origin/main\n", stderr: "" };
    if (a.startsWith("status")) return { code: 0, stdout: "", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
}
const collect = (patch) => collectHygiene({ ...input, ...patch });

test("hygiene refuses with exit 3 when git fetch fails and does not report stale data (glm #1)", async () => {
  const out = [];
  const err = [];
  const io = { out: (s) => out.push(s), err: (s) => err.push(s) };
  const run = fakeRun({ "fetch": { code: 128, stdout: "", stderr: "Could not resolve host" } });
  assert.equal(await main([], io, { run, now: () => NOW }), 3);
  assert.equal(out.join(""), "");
  assert.match(err.join(""), /Could not resolve host/);
  assert.match(err.join(""), /--no-fetch/);
  assert.equal(await main(["--no-fetch"], io, { run, now: () => NOW }), 0);
});

test("hygiene lists untracked files with non-ASCII names unescaped (glm #3, kimi #7)", () => {
  const calls = [];
  const run = fakeRun({ status: (cmd, args) => (calls.push(args), { code: 0, stdout: "?? Möbel.md\n", stderr: "" }) });
  const data = gather({ run, cwd: root, now: NOW });
  assert.deepEqual(data.untracked, ["Möbel.md"]);
  assert.ok(calls[0].join(" ").includes("core.quotePath=false"), calls[0].join(" "));
});

test("fakeRun matches the git subcommand and ignores -C path and -c values", () => {
  const hit = { code: 99, stdout: "", stderr: "override" };
  const run = fakeRun({ status: hit, fetch: hit });
  const wt = "/work/plan-status-03-fetch";
  const rev = run("git", ["-C", wt, "rev-parse", "--show-toplevel"]);
  assert.equal(rev.code, 0, "a -C path containing 'status' or 'fetch' must not hit an override");
  assert.equal(rev.stdout, `${root}
`);
  assert.equal(run("git", ["-C", wt, "-c", "core.status=x", "worktree", "list"]).code, 0);
  assert.equal(run("git", ["-C", wt, "-c", "core.quotePath=false", "status", "--porcelain"]).code, 99);
  assert.equal(run("git", ["-C", wt, "fetch", "--prune"]).code, 99);
});

test("MACHINE_BRANCH only excludes the exact machine branches (kimi #5)", () => {
  const f = collect({
    remoteBranches: [
      { name: "maintenance/w3-docs", merged: false },
      { name: "origin-x/foo", merged: false },
      { name: "mergify/merge-queue/abc", merged: false },
      { name: "gh-readonly-queue/main/pr-1", merged: false },
    ],
    prsAll: [],
  });
  assert.deepEqual(f.branchesWithoutPr.map((b) => b.name), ["maintenance/w3-docs", "origin-x/foo"]);
  const g = collect({ prsOpen: [{ number: 9, title: "x", headRefName: "maintenance/w3-docs", updatedAt: "2026-09-01T00:00:00Z", isDraft: false }] });
  assert.deepEqual(g.stalePrs.map((p) => p.number), [9]);
});

test("hygiene reports missing or unrecognisable inputs as not checked and --strict fails (kimi #2)", () => {
  const ok = collect({});
  assert.deepEqual(ok.notChecked, []);
  const missing = collect({ standText: null, planText: null, erledigtText: null });
  assert.equal(missing.notChecked.length, 3);
  assert.match(missing.notChecked.join("\n"), /STAND\.md/);
  assert.match(missing.notChecked.join("\n"), /docs\/PLAN\.md/);
  assert.match(missing.notChecked.join("\n"), /ERLEDIGT\.md/);
  const drifted = collect({ standText: "# ohne Abschnitt\n", planText: "| Foo | Bar |\n|---|---|\n", erledigtText: "keine Tabelle\n" });
  assert.equal(drifted.notChecked.length, 3);
  assert.ok(countFindings(missing) >= 3);
  assert.match(formatHygiene(missing), /Nicht geprüft/);
});

test("hygiene notChecked stays empty for the real repo files (kimi #2)", () => {
  const read = (p) => readFileSync(join(root, p), "utf8");
  const f = collect({ standText: read("STAND.md"), planText: read("docs/PLAN.md"), erledigtText: read("docs/ERLEDIGT.md") });
  assert.deepEqual(f.notChecked, []);
});

test("gather returns null for an input file that does not exist (kimi #2)", () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-hygiene-"));
  try {
    const data = gather({ run: fakeRun({ "rev-parse": { code: 0, stdout: `${dir}\n`, stderr: "" } }), cwd: dir, now: NOW });
    assert.equal(data.standText, null);
    assert.equal(data.planText, null);
    assert.equal(data.erledigtText, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hygiene names the git error when rev-parse fails instead of using the cwd (kimi #3)", async () => {
  const err = [];
  const run = fakeRun({ "rev-parse": { code: 128, stdout: "", stderr: "fatal: not a git repository" } });
  assert.equal(await main(["--no-fetch"], { out: () => {}, err: (s) => err.push(s) }, { run, now: () => NOW }), 3);
  assert.match(err.join(""), /not a git repository/);
});

test("hygiene flags gh lists that hit their limit as possibly incomplete (kimi #6)", () => {
  const many = (n) => Array.from({ length: n }, (_, i) => ({ number: i + 1, title: "t", headRefName: `claude/x${i}`, updatedAt: "2026-09-25T11:00:00Z", isDraft: false, state: "OPEN" }));
  const run = fakeRun({ "--state open": { code: 0, stdout: JSON.stringify(many(200)), stderr: "" }, "--state all": { code: 0, stdout: JSON.stringify(many(1000)), stderr: "" } });
  const data = gather({ run, cwd: root, now: NOW });
  assert.equal(data.limits.length, 2);
  const f = collectHygiene(data);
  assert.equal(f.notChecked.filter((n) => /gh/.test(n) && /200|1000/.test(n)).length, 2);
  const small = gather({ run: fakeRun(), cwd: root, now: NOW });
  assert.deepEqual(small.limits, []);
});

test("hygiene reports a gh failure as exit 3 (glm #6)", async () => {
  const err = [];
  const run = fakeRun({ "--state open": { code: 1, stdout: "", stderr: "gh: not logged in" } });
  assert.equal(await main(["--no-fetch"], { out: () => {}, err: (s) => err.push(s) }, { run, now: () => NOW }), 3);
  assert.match(err.join(""), /not logged in/);
});

test("hygiene reports a malformed Z goal table of docs/PLAN.md instead of passing it silently", () => {
  const head = "| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |\n|---|---|---|---|---|---|---|---|---|\n";
  const good = "| Z2-A | x | o | – | egal | C | Geplant | a | – |\n";
  const clean = collect({ planText: `## Z2 — Setup\n\n${head}${good}` });
  assert.deepEqual(clean.notChecked, []);
  const broken = collect({ planText: `## Z2 — Setup\n\n${head}${good}| Z2-B | x | o | Geplant |\n\n## Z3 — Rest\n\nNur Prosa.\n` });
  assert.equal(broken.notChecked.length, 2);
  assert.match(broken.notChecked.join("\n"), /Z2-B.*4 statt 9 Spalten/);
  assert.match(broken.notChecked.join("\n"), /Z3.*keine Tabelle/);
  assert.ok(countFindings(broken) >= 2);
});

// Z2-HYGIENE-STATUS — current PLAN status tokens (Draft / Ready / In Arbeit).
const Z_HEAD =
  "| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |\n|---|---|---|---|---|---|---|---|---|\n";

test("current PLAN Draft Ready and In Arbeit statuses are recognized", () => {
  const plan = [
    "## Z2 — Setup",
    "",
    Z_HEAD.trimEnd(),
    "| Z2-D1 | draft row | o | – | egal | B | Draft #1 | a | – |",
    "| Z2-R2 | ready row | o | – | egal | B | Ready #2 | a | – |",
    "| Z2-IA | running | o | – | egal | B | In Arbeit | a | – |",
    // siblings: legacy tokens still recognized
    "| Z2-OLD | legacy | o | – | egal | B | in Arbeit PR #10 | a | – |",
    "| Z2-PR | legacy pr | o | – | egal | B | PR #11 | a | – |",
    // two candidate PRs
    "| Z2-DS | drafts | o | – | egal | B | Drafts #3/#4 | a | – |",
    // explained predecessor / historical numbers must not become candidates
    "| Z2-PRED | pred | o | – | egal | B | Draft #5 (Vorgänger PR #99; früher #88) | a | – |",
    // negatives: not startable / not in progress
    "| Z2-E | done | o | – | egal | B | Erledigt | a | – |",
    "| Z2-B | blocked | o | – | egal | B | Blockiert | a | – |",
    "| Z2-P | pending | o | – | egal | B | Pending | a | – |",
    "| Z2-G | planned | o | – | egal | B | Geplant | a | – |",
    "",
  ].join("\n");

  const rows = inProgressPackages(plan);
  assert.deepEqual(
    rows.map((r) => [r.id, r.prNumbers]),
    [
      ["Z2-D1", [1]],
      ["Z2-R2", [2]],
      ["Z2-IA", []],
      ["Z2-OLD", [10]],
      ["Z2-PR", [11]],
      ["Z2-DS", [3, 4]],
      ["Z2-PRED", [5]],
    ],
  );

  // collectHygiene: open candidate PR suppresses the finding; missing does not.
  const openOk = collectHygiene({
    ...input,
    planText: plan,
    prsOpen: [
      { number: 1, title: "Z2-D1", headRefName: "cursor/z2-d1", updatedAt: "2026-09-25T11:00:00Z", isDraft: true },
      { number: 2, title: "Z2-R2", headRefName: "cursor/z2-r2", updatedAt: "2026-09-25T11:00:00Z", isDraft: false },
      { number: 3, title: "Z2-DS", headRefName: "cursor/z2-ds-a", updatedAt: "2026-09-25T11:00:00Z", isDraft: true },
      { number: 4, title: "Z2-DS", headRefName: "cursor/z2-ds-b", updatedAt: "2026-09-25T11:00:00Z", isDraft: true },
      { number: 5, title: "Z2-PRED", headRefName: "cursor/z2-pred", updatedAt: "2026-09-25T11:00:00Z", isDraft: true },
      { number: 10, title: "Z2-OLD", headRefName: "cursor/z2-old", updatedAt: "2026-09-25T11:00:00Z", isDraft: false },
      { number: 11, title: "Z2-PR", headRefName: "cursor/z2-pr", updatedAt: "2026-09-25T11:00:00Z", isDraft: false },
    ],
  });
  assert.deepEqual(openOk.inProgressWithoutPr.map((r) => r.id), ["Z2-IA"]);

  const missing = collectHygiene({
    ...input,
    planText: [
      "## Z2 — Setup",
      "",
      Z_HEAD.trimEnd(),
      "| Z2-MISS | missing draft | o | – | egal | B | Draft #9 | a | – |",
      "",
    ].join("\n"),
    prsOpen: [],
  });
  assert.deepEqual(missing.inProgressWithoutPr.map((r) => r.id), ["Z2-MISS"]);
  assert.deepEqual(missing.inProgressWithoutPr[0].prNumbers, [9]);
});
