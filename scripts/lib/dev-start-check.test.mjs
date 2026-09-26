// OPS-02: start-check decides from injected RAM, process list, usage file and
// log file times. No real process is listed and no real file is read.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkRam,
  checkCargo,
  checkUsage,
  checkObserve,
  countBuilds,
  parseUsage,
  parseWindowsProcesses,
  parseLinuxStat,
  listCargoProcesses,
  main,
} from "../dev/start-check.mjs";

const GB = 1024 ** 3;
const NOW = Date.parse("2026-09-26T10:00:00Z");
const proc = (pid, name, ppid) => ({ pid, name, ppid, cmd: name });

function run(argv, deps = {}) {
  let out = "";
  let err = "";
  const io = { out: (s) => (out += s), err: (s) => (err += s) };
  const base = {
    freeBytes: () => 8 * GB,
    processes: () => [],
    readFile: () => null,
    stat: () => ({ exists: false }),
    now: () => NOW,
  };
  return main(argv, io, { ...base, ...deps }).then((code) => ({ code, out, err }));
}

test("checkRam stops below the threshold and passes at it", () => {
  assert.equal(checkRam({ freeBytes: 1 * GB, minFreeGb: 1.5 }).status, "stopp");
  assert.equal(checkRam({ freeBytes: 1.5 * GB, minFreeGb: 1.5 }).status, "ok");
  assert.match(checkRam({ freeBytes: 1 * GB, minFreeGb: 1.5 }).text, /1\.0 GB/);
});

test("countBuilds counts build roots, not the rustup proxy or rustc children", () => {
  // cargo proxy -> real cargo -> two rustc; a second, independent cargo build
  const list = [
    proc(10, "cargo.exe", 1),
    proc(11, "cargo.exe", 10),
    proc(12, "rustc.exe", 11),
    proc(13, "rustc.exe", 11),
    proc(20, "cargo-nextest.exe", 1),
    proc(21, "cargo.exe", 20),
    proc(99, "node.exe", 1),
  ];
  assert.equal(countBuilds(list), 2);
});

test("countBuilds treats a process with an unknown parent as a root", () => {
  assert.equal(countBuilds([proc(1, "rustc", undefined), proc(2, "rustc", 999)]), 2);
  assert.equal(countBuilds([]), 0);
});

test("checkCargo stops when the limit is reached and passes below it", () => {
  const two = [proc(1, "cargo", 0), proc(2, "cargo", 0)];
  assert.equal(checkCargo({ processes: two, maxCargo: 2 }).status, "stopp");
  assert.equal(checkCargo({ processes: two.slice(0, 1), maxCargo: 2 }).status, "ok");
  assert.equal(checkCargo({ processes: [], maxCargo: 2 }).status, "ok");
});

test("checkCargo warns instead of stopping when no process list is available", () => {
  const c = checkCargo({ processes: null, maxCargo: 2 });
  assert.equal(c.status, "warn");
});

test("parseUsage accepts the documented format and rejects garbage", () => {
  const ok = parseUsage('{"anbieterA":{"woche":40,"session":10}}');
  assert.deepEqual(ok, { anbieterA: { woche: 40, session: 10 } });
  assert.throws(() => parseUsage("not json"), /JSON/);
  assert.throws(() => parseUsage("[1,2]"), /Objekt/);
});

test("checkUsage stops at the weekly cap and at the session cap", () => {
  const week = checkUsage({ usage: { a: { woche: 85, session: 0 } }, cap: 85, sessionCap: 85 });
  assert.equal(week.status, "stopp");
  assert.match(week.text, /a/);
  assert.match(week.text, /woche/);
  const sess = checkUsage({ usage: { a: { woche: 10, session: 90 } }, cap: 85, sessionCap: 85 });
  assert.equal(sess.status, "stopp");
  assert.match(sess.text, /session/);
  assert.equal(checkUsage({ usage: { a: { woche: 84.9, session: 84.9 } }, cap: 85, sessionCap: 85 }).status, "ok");
});

test("checkUsage names every provider that is over the cap", () => {
  const c = checkUsage({ usage: { a: { woche: 90, session: 0 }, b: { woche: 1, session: 99 }, c: { woche: 1, session: 1 } }, cap: 85, sessionCap: 85 });
  assert.equal(c.status, "stopp");
  assert.match(c.text, /a/);
  assert.match(c.text, /b/);
  assert.doesNotMatch(c.text, /\bc\b/);
});

test("checkUsage stops on a non-numeric value instead of passing it", () => {
  const c = checkUsage({ usage: { a: { woche: "viel", session: 1 } }, cap: 85, sessionCap: 85 });
  assert.equal(c.status, "stopp");
});

test("checkUsage warns when there is no usage file or no path was given", () => {
  assert.equal(checkUsage({ usage: null, cap: 85, sessionCap: 85, file: "usage.json" }).status, "warn");
  assert.equal(checkUsage({ usage: undefined, cap: 85, sessionCap: 85 }).status, "warn");
});

test("checkObserve passes for a fresh non-empty log", () => {
  const stat = () => ({ exists: true, size: 120, mtimeMs: NOW - 30_000 });
  assert.equal(checkObserve({ stat, file: "w.log", sinceSec: 300, now: NOW }).status, "ok");
});

test("checkObserve reports silent for a missing, empty or stale log", () => {
  const cases = [
    { exists: false },
    { exists: true, size: 0, mtimeMs: NOW - 1000 },
    { exists: true, size: 50, mtimeMs: NOW - 301_000 },
  ];
  for (const s of cases) {
    const c = checkObserve({ stat: () => s, file: "w.log", sinceSec: 300, now: NOW });
    assert.equal(c.status, "stumm", JSON.stringify(s));
  }
});

test("parseWindowsProcesses reads parent ids and accepts one object or an array", () => {
  const one = parseWindowsProcesses('{"ProcessId":5,"ParentProcessId":2,"Name":"rustc.exe","CommandLine":"x"}');
  assert.deepEqual(one, [{ pid: 5, ppid: 2, name: "rustc.exe", cmd: "x" }]);
  assert.deepEqual(parseWindowsProcesses(""), []);
});

test("parseLinuxStat takes the parent id after the last closing parenthesis", () => {
  assert.equal(parseLinuxStat("123 (cargo) S 45 123 123 0 -1"), 45);
  assert.equal(parseLinuxStat("123 (we) ird) S 77 1 1 0"), 77);
  assert.equal(parseLinuxStat("garbage"), undefined);
});

test("listCargoProcesses uses the injected runner and returns null on failure", () => {
  const seen = [];
  const good = listCargoProcesses({
    platform: "win32",
    run: (cmd, args) => {
      seen.push(cmd);
      return { code: 0, stdout: '[{"ProcessId":1,"ParentProcessId":0,"Name":"cargo.exe","CommandLine":"cargo build"}]', stderr: "" };
    },
  });
  assert.equal(seen[0], "powershell");
  assert.equal(good.length, 1);
  assert.equal(listCargoProcesses({ platform: "win32", run: () => ({ code: 1, stdout: "", stderr: "x" }) }), null);
  assert.equal(listCargoProcesses({ platform: "darwin", run: () => assert.fail("must not run") }), null);
});

test("main exits 0 and prints one German OK line per check when everything is fine", async () => {
  const r = await run([]);
  assert.equal(r.code, 0, r.err);
  const lines = r.out.trim().split("\n");
  assert.ok(lines.some((l) => /^OK\s+RAM/.test(l)), r.out);
  assert.ok(lines.some((l) => /^OK\s+cargo/i.test(l)), r.out);
  assert.doesNotMatch(r.out, /STOPP/);
});

test("main exits 1 with a STOPP line when free RAM is below --min-free-gb", async () => {
  const r = await run(["--min-free-gb", "4"], { freeBytes: () => 3 * GB });
  assert.equal(r.code, 1);
  assert.match(r.out, /^STOPP\s+RAM/m);
});

test("main defaults: 1.5 GB RAM threshold and at most 2 cargo builds", async () => {
  assert.equal((await run([], { freeBytes: () => 1.4 * GB })).code, 1);
  assert.equal((await run([], { freeBytes: () => 1.6 * GB })).code, 0);
  const two = () => [proc(1, "cargo", 0), proc(2, "cargo", 0)];
  assert.equal((await run([], { processes: two })).code, 1);
  assert.equal((await run(["--max-cargo", "3"], { processes: two })).code, 0);
});

test("main stops on a usage file over the cap and honours --cap", async () => {
  const readFile = () => '{"p":{"woche":86,"session":5}}';
  const stop = await run(["--usage", "u.json"], { readFile });
  assert.equal(stop.code, 1);
  assert.match(stop.out, /^STOPP\s+Limit/m);
  const pass = await run(["--usage", "u.json", "--cap", "90"], { readFile });
  assert.equal(pass.code, 0, pass.out);
});

test("main only warns when the usage file is missing (exit 0)", async () => {
  const r = await run(["--usage", "missing.json"], { readFile: () => null });
  assert.equal(r.code, 0);
  assert.match(r.out, /^WARNUNG\s+Limit/m);
});

test("main stops on an unreadable usage file", async () => {
  const r = await run(["--usage", "u.json"], { readFile: () => "{kaputt" });
  assert.equal(r.code, 1);
  assert.match(r.out, /^STOPP\s+Limit/m);
});

test("main exits 3 when the observed log is silent", async () => {
  const r = await run(["--observe-log", "w.log", "--since-sec", "60"], { stat: () => ({ exists: true, size: 0, mtimeMs: NOW }) });
  assert.equal(r.code, 3);
  assert.match(r.out, /^STOPP\s+Beobachtung.*stumm/m);
});

test("main passes the observation for a log written within --since-sec", async () => {
  const r = await run(["--observe-log", "w.log"], { stat: () => ({ exists: true, size: 9, mtimeMs: NOW - 299_000 }) });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^OK\s+Beobachtung/m);
});

test("main: a limit violation (1) wins over a silent log (3)", async () => {
  const r = await run(["--observe-log", "w.log"], { freeBytes: () => 1 * GB, stat: () => ({ exists: false }) });
  assert.equal(r.code, 1);
  assert.match(r.out, /STOPP\s+Beobachtung/);
});

test("main --json prints machine-readable checks and the exit code", async () => {
  const r = await run(["--json", "--min-free-gb", "99"]);
  const j = JSON.parse(r.out);
  assert.equal(j.ok, false);
  assert.equal(j.exit, 1);
  assert.deepEqual(
    j.checks.map((c) => c.id),
    ["ram", "cargo", "limit", "beobachtung"],
  );
  assert.equal(j.checks[0].status, "stopp");
});

test("main rejects bad arguments with exit 2", async () => {
  assert.equal((await run(["--min-free-gb", "viel"])).code, 2);
  assert.equal((await run(["--max-cargo", "-1"])).code, 2);
  assert.equal((await run(["--since-sec", "60"])).code, 2, "--since-sec needs --observe-log");
  assert.equal((await run(["--nope"])).code, 2);
});

test("main --help lists the exit codes", async () => {
  const r = await run(["--help"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /Exit-Codes/);
});
