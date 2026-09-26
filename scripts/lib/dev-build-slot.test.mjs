// SETUP-08a: build-slot decides from injected processes, file times and RAM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLocaleNumber } from "./dev-tools.mjs";
import { slotStatus, parseWindowsProcesses, defaultSlots, listCargoProcesses, main } from "../dev/build-slot.mjs";

const GB = 1024 ** 3;
const NOW = Date.parse("2026-09-24T20:00:00Z");
const slots = [
  { name: "projecta-a", path: "C:/work/u/cargo-targets/projecta-a" },
  { name: "projecta-b", path: "C:/work/u/cargo-targets/projecta-b" },
  { name: "projecta-c", path: "C:/work/u/cargo-targets/projecta-c" },
  { name: "main", path: "C:/work/u/ProjectA/src-tauri/target" },
];
// every slot exists, nothing touched for an hour
const quietStat = () => ({ exists: true, mtimeMs: NOW - 3_600_000 });

test("parseLocaleNumber reads German and C decimal separators", () => {
  assert.equal(parseLocaleNumber("3,25"), 3.25);
  assert.equal(parseLocaleNumber("3.25"), 3.25);
  assert.equal(parseLocaleNumber(" 12 "), 12);
  assert.ok(Number.isNaN(parseLocaleNumber("n/a")));
});

test("build-slot marks a slot busy when a rustc command line names it", () => {
  const processes = [
    { pid: 1, name: "rustc.exe", cmd: "rustc --crate-name x --out-dir C:\\work\\u\\cargo-targets\\projecta-a\\debug\\deps -L dependency=C:\\work\\u\\cargo-targets\\projecta-a\\debug\\deps" },
    { pid: 2, name: "cargo.exe", cmd: "cargo clippy --all-targets" },
  ];
  const s = slotStatus({ slots, processes, freeBytes: 8 * GB, stat: quietStat, now: NOW });
  assert.equal(s.slots[0].state, "belegt");
  assert.match(s.slots[0].reason, /rustc/);
  assert.equal(s.slots[1].state, "frei");
  assert.equal(s.recommendation.slot.name, "projecta-b");
  assert.equal(s.unattributed, 1);
});

test("build-slot matches paths regardless of slash direction and case on Windows", () => {
  const processes = [{ pid: 3, name: "rustc", cmd: "--out-dir c:/work/U/Cargo-Targets/projecta-b/debug/deps" }];
  const s = slotStatus({ slots, processes, freeBytes: 8 * GB, stat: quietStat, now: NOW, platform: "win32" });
  assert.equal(s.slots[1].state, "belegt");
});

test("build-slot falls back to the lock-file heuristic", () => {
  const stat = (p) =>
    /projecta-a[\\/]debug[\\/]\.cargo-lock$/.test(p) ? { exists: true, mtimeMs: NOW - 20_000 } : quietStat(p);
  const s = slotStatus({ slots, processes: null, freeBytes: 8 * GB, stat, now: NOW });
  assert.equal(s.slots[0].state, "vermutlich belegt");
  assert.equal(s.recommendation.slot.name, "projecta-b");
});

test("build-slot skips a missing slot directory", () => {
  const stat = (p) => (p.includes("projecta-a") ? { exists: false } : quietStat(p));
  const s = slotStatus({ slots, processes: [], freeBytes: 8 * GB, stat, now: NOW });
  assert.equal(s.slots[0].state, "fehlt");
  assert.equal(s.recommendation.slot.name, "projecta-b");
});

test("build-slot recommends waiting under 2.5 GB free RAM", () => {
  const s = slotStatus({ slots, processes: [], freeBytes: 2 * GB, stat: quietStat, now: NOW });
  assert.equal(s.recommendation.slot, null);
  assert.match(s.recommendation.text, /RAM/);
});

test("build-slot recommends waiting when three builds already run", () => {
  const processes = ["a", "b", "c"].map((x, i) => ({ pid: i, name: "rustc", cmd: `--out-dir C:/work/u/cargo-targets/projecta-${x}/debug/deps` }));
  const s = slotStatus({ slots, processes, freeBytes: 12 * GB, stat: quietStat, now: NOW });
  assert.equal(s.recommendation.slot, null);
  assert.match(s.recommendation.text, /drei|3/);
});

test("build-slot recommendation never sets CARGO_PROFILE_*", () => {
  const s = slotStatus({ slots, processes: [], freeBytes: 8 * GB, stat: quietStat, now: NOW });
  assert.match(s.recommendation.env, /CARGO_TARGET_DIR=/);
  assert.doesNotMatch(s.recommendation.env, /CARGO_PROFILE/);
});

test("parseWindowsProcesses accepts a single object and an array", () => {
  const one = parseWindowsProcesses('{"ProcessId":5,"Name":"rustc.exe","CommandLine":"x"}');
  assert.deepEqual(one, [{ pid: 5, name: "rustc.exe", cmd: "x" }]);
  const many = parseWindowsProcesses('[{"ProcessId":5,"Name":"rustc.exe","CommandLine":null},{"ProcessId":6,"Name":"cargo.exe","CommandLine":"cargo"}]');
  assert.equal(many.length, 2);
  assert.equal(many[0].cmd, "");
  assert.deepEqual(parseWindowsProcesses(""), []);
});

test("defaultSlots honours PA_BUILD_SLOTS", () => {
  const d = defaultSlots({ home: "C:/work/u", mainCheckout: "C:/r", env: {} });
  assert.deepEqual(d.map((s) => s.name), ["projecta-a", "projecta-b", "projecta-c", "main"]);
  const custom = defaultSlots({ home: "/h", mainCheckout: "/r", env: { PA_BUILD_SLOTS: "/x/one;/x/two" } });
  assert.deepEqual(custom.map((s) => s.path), ["/x/one", "/x/two"]);
});

test("build-slot CLI exits 3 when no slot is usable and 0 otherwise", async () => {
  const out = [];
  const io = { out: (s) => out.push(s), err: (s) => out.push(s) };
  const deps = { slots, processes: () => [], freeBytes: () => 1 * GB, stat: quietStat, now: () => NOW };
  assert.equal(await main([], io, deps), 3);
  assert.equal(await main(["--json"], io, { ...deps, freeBytes: () => 8 * GB }), 0);
  assert.equal(JSON.parse(out.at(-1)).recommendation.slot.name, "projecta-a");
});

test("build-slot --help exits 0", async () => {
  const out = [];
  assert.equal(await main(["--help"], { out: (s) => out.push(s), err: (s) => out.push(s) }), 0);
  assert.match(out.join(""), /build-slot/);
});

test("the Windows process query includes clippy and build-script processes (G3)", () => {
  const seen = [];
  const run = (cmd, args) => {
    seen.push(args.join(" "));
    return { code: 0, stdout: "[]", stderr: "" };
  };
  listCargoProcesses({ run, platform: "win32" });
  const filter = seen.join(" ");
  assert.match(filter, /cargo-clippy\.exe/);
  assert.match(filter, /build-script-build\.exe/);
});

test("isCargoProcessName accepts comm names truncated at 15 characters (G4/N3)", async () => {
  const { isCargoProcessName } = await import("../dev/build-slot.mjs");
  assert.equal(typeof isCargoProcessName, "function");
  assert.equal(isCargoProcessName("cargo"), true);
  assert.equal(isCargoProcessName("rustc.exe"), true);
  assert.equal(isCargoProcessName("build-script-bu"), true); // /proc/<pid>/comm Schnitt bei 15 Zeichen
  assert.equal(isCargoProcessName("build-script-build"), true);
  assert.equal(isCargoProcessName("build-script-bu2"), false);
  assert.equal(isCargoProcessName("my-cargo-build"), false);
  assert.equal(isCargoProcessName("cargo-fmt"), false);
});

test("namesSlot never matches a longer slot name (end-of-token)", async () => {
  const { namesSlot } = await import("../dev/build-slot.mjs");
  assert.equal(typeof namesSlot, "function");
  assert.equal(namesSlot("rustc --out-dir C:/u/cargo-targets/projecta-ab/debug/deps", "C:/u/cargo-targets/projecta-a", "win32"), false);
  assert.equal(namesSlot("rustc --out-dir C:/u/cargo-targets/projecta-a-x/debug/deps", "C:/u/cargo-targets/projecta-a", "win32"), false);
  assert.equal(namesSlot("rustc --out-dir C:/u/cargo-targets/projecta-a/debug/deps", "C:/u/cargo-targets/projecta-a", "win32"), true);
  assert.equal(namesSlot("rustc --out-dir C:/u/cargo-targets/projecta-a", "C:/u/cargo-targets/projecta-a", "win32"), true);
});

test("build-slot treats a fresh lock as probably busy even with a process list (M3)", () => {
  const stat = (p) => (/projecta-a[\\/]debug[\\/]\.cargo-lock$/.test(p) ? { exists: true, mtimeMs: NOW - 20_000 } : quietStat(p));
  const processes = [{ pid: 9, name: "cargo.exe", cmd: "cargo build" }]; // Startphase: kein Slot in der Kommandozeile
  const s = slotStatus({ slots, processes, freeBytes: 8 * GB, stat, now: NOW });
  assert.equal(s.slots[0].state, "vermutlich belegt");
});

test("build-slot counts unattributed cargo processes toward the busy limit (M3)", () => {
  const processes = [1, 2, 3].map((i) => ({ pid: i, name: "cargo.exe", cmd: "cargo test" }));
  const s = slotStatus({ slots, processes, freeBytes: 12 * GB, stat: quietStat, now: NOW });
  assert.equal(s.busy, 3);
  assert.equal(s.recommendation.slot, null);
  assert.match(s.recommendation.text, /drei|3/);
});

test("build-slot heuristic also watches the release profile (N2)", () => {
  const stat = (p) => (/projecta-b[\\/]release[\\/]deps$/.test(p) ? { exists: true, mtimeMs: NOW - 30_000 } : quietStat(p));
  const s = slotStatus({ slots, processes: null, freeBytes: 8 * GB, stat, now: NOW });
  assert.equal(s.slots[1].state, "vermutlich belegt");
});
