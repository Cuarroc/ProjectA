// M2: the status report must be provable without GitHub. Every test feeds a
// fake `gh` (an injected run function) or plain data — no binary is spawned, no
// network is touched, no local time zone is assumed — so the file runs the same
// in `npm run test:hq` on Windows and on the Linux CI runner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_LINES,
  checkState,
  classify,
  collect,
  formatReport,
  main,
} from "../dev/status-report.mjs";

const NOW = new Date("2026-09-25T10:00:00Z");
const TZ = "Europe/Berlin";

const green = [
  { __typename: "CheckRun", name: "gates (linux)", status: "COMPLETED", conclusion: "SUCCESS" },
  { __typename: "CheckRun", name: "red-first", status: "COMPLETED", conclusion: "SUCCESS" },
  { __typename: "CheckRun", name: "Mergify Merge Protections", status: "COMPLETED", conclusion: "NEUTRAL" },
];

function pr(number, over = {}) {
  return {
    number,
    title: `PR ${number}`,
    isDraft: false,
    headRefName: `claude/pr-${number}`,
    author: { login: "Cuarroc", is_bot: false },
    labels: [],
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    statusCheckRollup: green,
    ...over,
  };
}

function data(over = {}) {
  return { openPrs: [], mergedPrs: [], mainRuns: [], errors: [], ...over };
}

test("checkState: failing beats pending beats green; neutral and skipped do not count", () => {
  assert.equal(checkState(green), "green");
  assert.equal(checkState([]), "none");
  assert.equal(checkState([...green, { __typename: "CheckRun", status: "IN_PROGRESS", conclusion: "" }]), "pending");
  assert.equal(
    checkState([
      { __typename: "CheckRun", status: "IN_PROGRESS", conclusion: "" },
      { __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" },
    ]),
    "failing",
  );
  assert.equal(checkState([{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SKIPPED" }]), "green");
  assert.equal(checkState([{ __typename: "StatusContext", state: "PENDING" }]), "pending");
  assert.equal(checkState([{ __typename: "StatusContext", state: "ERROR" }]), "failing");
});

test("classify: drafts are running, queued and green-ready PRs are running, red or blocked ready PRs need a decision", () => {
  const model = classify(
    data({
      openPrs: [
        pr(1, { isDraft: true }),
        pr(2, { labels: [{ name: "queued" }] }),
        pr(3),
        pr(4, { statusCheckRollup: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" }] }),
        pr(5, { labels: [{ name: "do-not-merge" }] }),
        pr(6, { labels: [{ name: "dequeued" }] }),
        pr(7, { mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }),
        pr(8, { statusCheckRollup: [{ __typename: "CheckRun", status: "IN_PROGRESS", conclusion: "" }] }),
      ],
    }),
    { now: NOW, timeZone: TZ },
  );
  const numbers = (items) => items.map((i) => i.number).filter(Boolean);
  assert.deepEqual(numbers(model.running), [1, 2, 3, 8]);
  assert.deepEqual(numbers(model.decide), [4, 5, 6, 7]);
});

test("classify: Mergify queue PRs are plumbing and never listed", () => {
  const model = classify(
    data({
      openPrs: [
        pr(160, { isDraft: true, headRefName: "mergify/merge-queue/217e7e1d47", author: { login: "app/mergify", is_bot: true } }),
        pr(9),
      ],
    }),
    { now: NOW, timeZone: TZ },
  );
  assert.deepEqual(model.running.map((i) => i.number), [9]);
});

test("classify: Dependabot PRs collapse into one line for the user", () => {
  const dep = (n) => pr(n, { author: { login: "app/dependabot", is_bot: true }, headRefName: `dependabot/npm_and_yarn/x-${n}` });
  const model = classify(data({ openPrs: [dep(109), dep(111)] }), { now: NOW, timeZone: TZ });
  assert.equal(model.decide.length, 1);
  assert.match(model.decide[0].text, /2 Dependabot/);
  assert.equal(model.running.length, 0);
});

test("classify: only PRs merged today (local day) are done", () => {
  const model = classify(
    data({
      mergedPrs: [
        { number: 10, title: "today, early UTC", mergedAt: "2026-09-25T00:40:32Z" },
        { number: 11, title: "yesterday late evening Berlin", mergedAt: "2026-09-24T21:59:59Z" },
        { number: 12, title: "yesterday", mergedAt: "2026-09-24T09:00:00Z" },
      ],
    }),
    { now: NOW, timeZone: TZ },
  );
  assert.deepEqual(model.done.map((i) => i.number), [10]);
});

test("classify: the day boundary follows the requested time zone, not the machine's", () => {
  const mergedPrs = [{ number: 13, title: "late", mergedAt: "2026-09-24T22:30:00Z" }];
  const berlin = classify(data({ mergedPrs }), { now: NOW, timeZone: "Europe/Berlin" });
  const utc = classify(data({ mergedPrs }), { now: NOW, timeZone: "UTC" });
  assert.deepEqual(berlin.done.map((i) => i.number), [13]); // 00:30 on the 25th in Berlin
  assert.deepEqual(utc.done.map((i) => i.number), []); // still the 24th in UTC
});

test("classify: a red main is the first thing the user must decide", () => {
  const model = classify(
    data({
      openPrs: [pr(4, { statusCheckRollup: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" }] })],
      mainRuns: [
        { status: "in_progress", conclusion: "", name: "ci", headSha: "bbbbbbb1234", url: "https://x/run/2", createdAt: "2026-09-25T09:00:00Z" },
        { status: "completed", conclusion: "failure", name: "ci", headSha: "aaaaaaa1234", url: "https://x/run/1", createdAt: "2026-09-25T08:00:00Z" },
      ],
    }),
    { now: NOW, timeZone: TZ },
  );
  assert.equal(model.mainRed, true);
  assert.match(model.decide[0].text, /main ist rot/i);
  assert.match(model.decide[0].text, /aaaaaaa/);
  assert.equal(model.decide[1].number, 4);
});

test("classify: main is not red while the latest finished run is green", () => {
  const model = classify(
    data({
      mainRuns: [
        { status: "in_progress", conclusion: "", name: "ci", headSha: "b", createdAt: "2026-09-25T09:00:00Z" },
        { status: "completed", conclusion: "success", name: "ci", headSha: "a", createdAt: "2026-09-25T08:00:00Z" },
        { status: "completed", conclusion: "failure", name: "ci", headSha: "z", createdAt: "2026-09-24T08:00:00Z" },
      ],
    }),
    { now: NOW, timeZone: TZ },
  );
  assert.equal(model.mainRed, false);
});

test("formatReport: three German sections in a fixed order", () => {
  const text = formatReport(classify(data(), { now: NOW, timeZone: TZ }), { now: NOW, timeZone: TZ });
  const headings = text.split("\n").filter((l) => l.startsWith("## "));
  assert.deepEqual(headings, ["## Fertig", "## Läuft", "## Du entscheidest"]);
  assert.match(text, /Nichts fertig/);
  assert.match(text, /Nichts läuft/);
  assert.match(text, /Nichts zu entscheiden/);
});

test("formatReport: never exceeds 25 lines, however many PRs there are, and says what it cut", () => {
  const openPrs = [];
  for (let i = 1; i <= 40; i++) openPrs.push(pr(i, { isDraft: true }));
  for (let i = 41; i <= 80; i++) openPrs.push(pr(i, { labels: [{ name: "do-not-merge" }] }));
  const mergedPrs = [];
  for (let i = 81; i <= 120; i++) mergedPrs.push({ number: i, title: `merged ${i}`, mergedAt: "2026-09-25T05:00:00Z" });
  const opts = { now: NOW, timeZone: TZ };
  const text = formatReport(classify(data({ openPrs, mergedPrs }), opts), opts);
  const lines = text.replace(/\n$/, "").split("\n");
  assert.ok(lines.length <= MAX_LINES, `${lines.length} lines`);
  assert.equal(MAX_LINES, 25);
  assert.match(text, /und \d+ weitere/);
  assert.match(text, /40 Entwürfe|40 Entwurf/); // the tally is kept even when the list is cut
});

test("formatReport: long titles are shortened, not wrapped", () => {
  const opts = { now: NOW, timeZone: TZ };
  const long = "x".repeat(300);
  const text = formatReport(classify(data({ openPrs: [pr(1, { title: long })] }), opts), opts);
  for (const line of text.split("\n")) assert.ok(line.length <= 120, `line too long: ${line.length}`);
});

test("formatReport: shortening cuts the title, never the reason the PR is listed", () => {
  const opts = { now: NOW, timeZone: TZ };
  const long = "y".repeat(300);
  const text = formatReport(classify(data({ openPrs: [pr(1, { title: long, mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" })] }), opts), opts);
  assert.match(text, /— Konflikt mit main/);
});

test("formatReport: a gh failure is reported under 'Du entscheidest', not swallowed", () => {
  const opts = { now: NOW, timeZone: TZ };
  const text = formatReport(classify(data({ errors: ["gh pr list: exit 1 (not logged in)"] }), opts), opts);
  assert.match(text, /gh pr list/);
  assert.doesNotMatch(text, /Nichts zu entscheiden/);
});

test("collect: reads PRs, merged PRs and main runs through gh with fixed arguments only", () => {
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, ...args]);
    const kind = args.slice(0, 2).join(" ");
    const out =
      kind === "pr list" && args.includes("merged")
        ? [{ number: 5, title: "m", mergedAt: "2026-09-25T05:00:00Z" }]
        : kind === "pr list"
          ? [pr(1)]
          : [{ status: "completed", conclusion: "success", name: "ci", headSha: "abc", createdAt: "2026-09-25T05:00:00Z" }];
    return { status: 0, stdout: JSON.stringify(out), stderr: "" };
  };
  const result = collect({ run });
  assert.equal(result.openPrs.length, 1);
  assert.equal(result.mergedPrs.length, 1);
  assert.equal(result.mainRuns.length, 1);
  assert.deepEqual(result.errors, []);
  assert.equal(calls.length, 3);
  for (const call of calls) assert.equal(call[0], "gh");
  // read-only: no gh subcommand that mutates anything
  for (const call of calls) assert.ok(!call.some((a) => /^(merge|close|edit|create|comment|review)$/.test(a)), call.join(" "));
});

test("collect: a failing gh call becomes an error entry, the other calls still run", () => {
  const run = (cmd, args) =>
    args.includes("merged")
      ? { status: 1, stdout: "", stderr: "gh: not logged in" }
      : { status: 0, stdout: "[]", stderr: "" };
  const result = collect({ run });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /not logged in/);
  assert.deepEqual(result.mergedPrs, []);
});

test("collect: unparsable gh output is an error, not a crash", () => {
  const run = () => ({ status: 0, stdout: "<html>", stderr: "" });
  const result = collect({ run });
  assert.equal(result.errors.length, 3);
});

test("main: prints the report to stdout and exits 0", () => {
  let out = "";
  const code = main([], {
    probe: () => data(),
    write: (s) => (out += s),
    now: NOW,
    timeZone: TZ,
  });
  assert.equal(code, 0);
  assert.match(out, /## Fertig/);
});

test("main --out writes the report to the file and keeps stdout quiet", () => {
  const dir = mkdtempSync(join(tmpdir(), "status-report-"));
  try {
    const file = join(dir, "sub", "report.md");
    let out = "";
    const code = main(["--out", file], { probe: () => data(), write: (s) => (out += s), now: NOW, timeZone: TZ });
    assert.equal(code, 0);
    assert.equal(out, "");
    assert.match(readFileSync(file, "utf8"), /## Du entscheidest/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("main: --out without a value and unknown flags exit 2 without collecting", () => {
  let probed = false;
  const opts = { probe: () => ((probed = true), data()), write: () => {}, error: () => {}, now: NOW, timeZone: TZ };
  assert.equal(main(["--out"], opts), 2);
  assert.equal(main(["--nope"], opts), 2);
  assert.equal(probed, false);
});

test("main: exits 1 when gh could not be read, but still prints what it has", () => {
  let out = "";
  const code = main([], { probe: () => data({ errors: ["gh pr list: boom"] }), write: (s) => (out += s), now: NOW, timeZone: TZ });
  assert.equal(code, 1);
  assert.match(out, /boom/);
});

test("checkState: a completed check without a conclusion is pending instead of green", () => {
  assert.equal(checkState([{ __typename: "CheckRun", name: "x", status: "COMPLETED", conclusion: null }]), "pending");
  assert.equal(checkState([{ __typename: "CheckRun", name: "x", status: "COMPLETED" }]), "pending");
});

test("classify: a finished main run counts however gh capitalizes its status", () => {
  const model = classify(
    data({
      mainRuns: [
        { status: "COMPLETED", conclusion: "FAILURE", name: "ci", headSha: "aaaaaaa1234", url: "https://x/run/1", createdAt: "2026-09-25T08:00:00Z" },
      ],
    }),
    { now: NOW, timeZone: TZ },
  );
  assert.equal(model.mainRed, true);
});

test("main: an unwritable --out target is a clean error instead of a crash", () => {
  const dir = mkdtempSync(join(tmpdir(), "status-report-"));
  try {
    let err = "";
    const code = main(["--out", join(dir, "report.md")], {
      probe: () => data(),
      write: () => {},
      error: (s) => (err += s),
      writeFile: () => {
        throw new Error("EACCES: permission denied");
      },
      now: NOW,
      timeZone: TZ,
    });
    assert.equal(code, 1);
    assert.match(err, /EACCES/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("classify: a conflicting draft gets its own running line and stays out of the tally", () => {
  const model = classify(
    data({
      openPrs: [
        pr(20, { isDraft: true }),
        pr(21, { isDraft: true, mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }),
      ],
    }),
    { now: NOW, timeZone: TZ },
  );
  assert.equal(model.running.length, 2);
  assert.match(model.running[0].text, /^1 Entwurf in Arbeit: #20$/);
  assert.equal(model.running[1].number, 21);
  assert.match(model.running[1].text, /Entwurf, Konflikt mit main/);
  assert.equal(model.decide.length, 0);
});

test("collect: a spawn error becomes an error entry, the other calls still run", () => {
  const run = (cmd, args) =>
    args.includes("merged")
      ? { error: new Error("spawn gh ENOENT"), status: null, stdout: "", stderr: "" }
      : { status: 0, stdout: "[]", stderr: "" };
  const result = collect({ run });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /ENOENT/);
  assert.equal(result.openPrs.length, 0);
});

test("formatReport: the simultaneous worst case (5 done, 6 running, 7 decide) fits the cap", () => {
  const mergedPrs = [];
  for (let i = 81; i <= 85; i++) mergedPrs.push({ number: i, title: `merged ${i}`, mergedAt: "2026-09-25T05:00:00Z" });
  const openPrs = [];
  for (let i = 1; i <= 6; i++) openPrs.push(pr(i));
  for (let i = 11; i <= 17; i++) openPrs.push(pr(i, { labels: [{ name: "do-not-merge" }] }));
  const opts = { now: NOW, timeZone: TZ };
  const model = classify(data({ openPrs, mergedPrs }), opts);
  assert.equal(model.done.length, 5);
  assert.equal(model.running.length, 6);
  assert.equal(model.decide.length, 7);
  const lines = formatReport(model, opts).replace(/\n$/, "").split("\n");
  assert.equal(lines.length, 25); // title + blank + 3 headings + 2 blanks + 5 + 6 + 7
  assert.ok(lines.length <= MAX_LINES);
});
