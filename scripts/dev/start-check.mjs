#!/usr/bin/env node
// OPS-02 — start-check: may another agent worker start right now?
//
// Four checks, one German line each; any limit violation is a hard stop:
//   1. free RAM below --min-free-gb (default 1.5)
//   2. running cargo builds at --max-cargo (default 2) or more: a new worker
//      would be one build too many
//   3. provider usage from a JSON file (--usage), {"<anbieter>":{"woche":n,
//      "session":n}}: weekly >= --cap (default 85) or session >= --session-cap
//      (default 85); a missing file is a warning, a broken one a stop
//   4. "model observed" (--observe-log, --since-sec): a worker that was
//      already started must have written something to its log in the last
//      N seconds (default 300): size > 0 and mtime younger than N s
//
// Builds are counted as roots of the cargo process forest: the rustup proxy
// cargo.exe and its real cargo child are one build, rustc/build scripts below
// cargo are part of it. RAM comes from os.freemem() (available physical
// memory on Windows and Linux), so no localized number is parsed. Every
// system query (RAM, processes, files, clock) is injectable for the tests.
import { statSync, readFileSync, readdirSync } from "node:fs";
import { freemem, platform as osPlatform } from "node:os";
import { parseArgs } from "node:util";
import { EXIT, UsageError, makeRunner, isMain, runCli, withExitCodes, parseLocaleNumber } from "../lib/dev-tools.mjs";
import { isCargoProcessName } from "./build-slot.mjs";

export const DEFAULT_MIN_FREE_GB = 1.5;
export const DEFAULT_MAX_CARGO = 2;
export const DEFAULT_CAP = 85;
export const DEFAULT_SINCE_SEC = 300;
export const DEFAULT_MAX_BEHIND = 40;
export const EXIT_SILENT = 3;

const HELP = `start-check — Startcheck vor jedem Agenten-Worker

Aufruf:
  npm run dev:start-check -- [--min-free-gb <GB>] [--max-cargo <n>]
                             [--usage <datei> [--cap <prozent>] [--session-cap <prozent>]]
                             [--observe-log <datei> [--since-sec <s>]]
                             [--deps [--max-behind <n>]] [--json]

Pruefungen (eine Zeile je Pruefung, OK / WARNUNG / STOPP):
  RAM          freier RAM unter --min-free-gb (Standard ${DEFAULT_MIN_FREE_GB}) -> STOPP
  cargo        laufende cargo-Builds >= --max-cargo (Standard ${DEFAULT_MAX_CARGO}) -> STOPP
  Limit        --usage-Datei {"<anbieter>":{"woche":n,"session":n}}: woche >= --cap
               (Standard ${DEFAULT_CAP}) oder session >= --session-cap (Standard ${DEFAULT_CAP}) -> STOPP;
               Datei fehlt -> WARNUNG, Datei kaputt -> STOPP
  Beobachtung  --observe-log: Log leer, fehlend oder aelter als --since-sec
               (Standard ${DEFAULT_SINCE_SEC} s) -> stumm, wahrscheinlich haengt
  Abhaengigkeiten (nur mit --deps, read-only, kein Netz; je ein STOPP bei):
    node_modules   fehlt oder ist aelter als package-lock.json -> npm ci
    Cargo-Deps     "cargo fetch --locked --offline" scheitert -> cargo fetch
    Basis          Branch liegt mehr als --max-behind (Standard ${DEFAULT_MAX_BEHIND}) Commits
                   hinter origin/main (lokaler Stand, vorher git fetch)

Exit-Codes: 0 alles frei, 1 Grenze verletzt (RAM, cargo, Limit), 2 Aufruffehler,
            3 Worker stumm (nur Beobachtung; bei zugleich verletzter Grenze gilt 1).
Ohne --json gibt es Klartext, mit --json ein Objekt {ok, exit, checks[]}.
`;

const fmt1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
const check = (id, label, status, text) => ({ id, label, status, text });

export function checkRam({ freeBytes, minFreeGb }) {
  const gb = freeBytes / 1024 ** 3;
  if (gb < minFreeGb) return check("ram", "RAM", "stopp", `nur ${fmt1(gb)} GB frei (Schwelle ${minFreeGb} GB)`);
  return check("ram", "RAM", "ok", `${fmt1(gb)} GB frei (Schwelle ${minFreeGb} GB)`);
}

// Roots of the forest formed by the cargo-family processes; a process whose
// parent is unknown (or not in the family) is a root.
export function countBuilds(processes) {
  const family = processes.filter((p) => isCargoProcessName(p.name));
  const pids = new Set(family.map((p) => p.pid));
  return family.filter((p) => !(p.ppid !== undefined && p.ppid !== p.pid && pids.has(p.ppid))).length;
}

export function checkCargo({ processes, maxCargo }) {
  if (!processes) return check("cargo", "cargo", "warn", "Prozessliste nicht lesbar, Builds nicht gezaehlt");
  const n = countBuilds(processes);
  if (n >= maxCargo) return check("cargo", "cargo", "stopp", `${n} cargo-Build(s) laufen (hoechstens ${maxCargo} gleichzeitig)`);
  return check("cargo", "cargo", "ok", `${n} cargo-Build(s) laufen (hoechstens ${maxCargo} gleichzeitig)`);
}

export function parseUsage(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`keine gueltige JSON-Datei (${e.message})`);
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) throw new Error("JSON-Objekt {anbieter:{woche,session}} erwartet");
  return data;
}

const isPercent = (v) => typeof v === "number" && Number.isFinite(v);

// usage: parsed object, null = file missing, undefined = no --usage given
export function checkUsage({ usage, cap, sessionCap, file }) {
  if (usage === undefined) return check("limit", "Limit", "warn", "keine --usage-Datei angegeben, Anbieter-Limit nicht geprueft");
  if (usage === null) return check("limit", "Limit", "warn", `Nutzungsdatei fehlt (${file}), Anbieter-Limit nicht geprueft`);
  const over = [];
  for (const [name, u] of Object.entries(usage)) {
    for (const [key, limit] of [["woche", cap], ["session", sessionCap]]) {
      const v = u?.[key];
      if (v === undefined) over.push(`${name}: ${key} fehlt`);
      else if (!isPercent(v)) over.push(`${name}: ${key} ungueltig (${JSON.stringify(v)})`);
      else if (v >= limit) over.push(`${name}: ${key} ${v} % >= ${limit} %`);
    }
  }
  if (over.length) return check("limit", "Limit", "stopp", over.join("; "));
  const n = Object.keys(usage).length;
  return check("limit", "Limit", "ok", `${n} Anbieter unter ${cap} % (Woche) und ${sessionCap} % (Session)`);
}

export function checkObserve({ stat, file, sinceSec, now }) {
  if (!file) return check("beobachtung", "Beobachtung", "skip", "kein --observe-log angegeben, nicht geprueft");
  const s = stat(file);
  if (!s.exists) return check("beobachtung", "Beobachtung", "stumm", `stumm, wahrscheinlich haengt: ${file} existiert nicht`);
  if (!(s.size > 0)) return check("beobachtung", "Beobachtung", "stumm", `stumm, wahrscheinlich haengt: ${file} ist leer`);
  const ageMs = now - s.mtimeMs;
  const ageSec = Math.round(ageMs / 1000);
  if (ageMs >= sinceSec * 1000) {
    return check("beobachtung", "Beobachtung", "stumm", `stumm, wahrscheinlich haengt: letzte Ausgabe vor ${ageSec} s (Grenze ${sinceSec} s)`);
  }
  return check("beobachtung", "Beobachtung", "ok", `Ausgabe vor ${Math.max(0, ageSec)} s (Grenze ${sinceSec} s)`);
}

// --deps (FLOW-04). node_modules/.package-lock.json is written by every npm
// install; the directory time is the fallback for older npm versions.
export function checkNodeModules({ stat }) {
  const lock = stat("package-lock.json");
  const hidden = stat("node_modules/.package-lock.json");
  const mod = hidden.exists ? hidden : stat("node_modules");
  if (!mod.exists) return check("node_modules", "node_modules", "stopp", "node_modules fehlt, bitte `npm ci` ausfuehren");
  if (lock.exists && mod.mtimeMs < lock.mtimeMs) {
    return check("node_modules", "node_modules", "stopp", "node_modules ist aelter als package-lock.json, bitte `npm ci` ausfuehren");
  }
  return check("node_modules", "node_modules", "ok", "node_modules ist aktuell zu package-lock.json");
}

export function checkCargoDeps({ run }) {
  const r = run("cargo", ["fetch", "--locked", "--offline", "--manifest-path", "src-tauri/Cargo.toml"]);
  if (r.code === 127) return check("cargo-deps", "Cargo-Deps", "warn", "cargo nicht gefunden, Cargo-Abhaengigkeiten nicht geprueft");
  if (r.code !== 0) return check("cargo-deps", "Cargo-Deps", "stopp", "Cargo-Abhaengigkeiten nicht geladen, bitte `cargo fetch` ausfuehren");
  return check("cargo-deps", "Cargo-Deps", "ok", "Cargo-Abhaengigkeiten sind geladen");
}

export function checkBehind({ run, maxBehind }) {
  const r = run("git", ["rev-list", "--count", "HEAD..origin/main"]);
  const n = Number(String(r.stdout).trim());
  if (r.code !== 0 || !Number.isInteger(n)) return check("basis", "Basis", "warn", "origin/main nicht lesbar, Abstand nicht geprueft");
  if (n > maxBehind) return check("basis", "Basis", "stopp", `Branch liegt ${n} Commits hinter origin/main (hoechstens ${maxBehind}), bitte main einmergen`);
  return check("basis", "Basis", "ok", `Branch liegt ${n} Commits hinter origin/main (hoechstens ${maxBehind})`);
}

// `Get-CimInstance ... | ConvertTo-Json` prints one object for one match.
export function parseWindowsProcesses(text) {
  const t = String(text || "").trim();
  if (!t) return [];
  const data = JSON.parse(t);
  return (Array.isArray(data) ? data : [data]).map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name || "", cmd: p.CommandLine || "" }));
}

// /proc/<pid>/stat is "pid (comm) state ppid ..."; comm may contain spaces and ")".
export function parseLinuxStat(text) {
  const rest = String(text).slice(String(text).lastIndexOf(")") + 1).trim().split(/\s+/);
  const ppid = Number(rest[1]);
  return rest.length > 1 && Number.isInteger(ppid) ? ppid : undefined;
}

function listLinuxProcesses() {
  const out = [];
  for (const pid of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
    try {
      const name = readFileSync(`/proc/${pid}/comm`, "utf8").trim();
      if (!isCargoProcessName(name)) continue;
      const ppid = parseLinuxStat(readFileSync(`/proc/${pid}/stat`, "utf8"));
      out.push({ pid: Number(pid), ppid, name, cmd: name });
    } catch {
      /* process ended */
    }
  }
  return out;
}

// null = could not determine (the cargo check then only warns)
export function listCargoProcesses({ run, platform = osPlatform() }) {
  try {
    if (platform === "win32") {
      const filter = "Name='cargo.exe' OR Name='rustc.exe' OR Name='clippy-driver.exe' OR Name='cargo-nextest.exe' OR Name='cargo-clippy.exe' OR Name='rustdoc.exe' OR Name='build-script-build.exe'";
      const r = run("powershell", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Get-CimInstance Win32_Process -Filter "${filter}" | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress`,
      ]);
      if (r.code !== 0) return null;
      return parseWindowsProcesses(r.stdout);
    }
    if (platform === "linux") return listLinuxProcesses();
    return null;
  } catch {
    return null;
  }
}

function realStat(p) {
  try {
    const s = statSync(p);
    return { exists: true, size: s.size, mtimeMs: s.mtimeMs };
  } catch {
    return { exists: false };
  }
}

// null = file missing
function realReadFile(p) {
  try {
    return readFileSync(p, "utf8");
  } catch (e) {
    if (e?.code === "ENOENT") return null;
    throw e;
  }
}

function number(name, text, { min = 0, integer = false } = {}) {
  const n = parseLocaleNumber(text);
  if (!Number.isFinite(n) || n < min || (integer && !Number.isInteger(n))) {
    throw new UsageError(`${name}: ${integer ? "ganze " : ""}Zahl >= ${min} erwartet, bekommen: ${text}`);
  }
  return n;
}

function format(checks) {
  const label = { ok: "OK", warn: "WARNUNG", stopp: "STOPP", stumm: "STOPP", skip: "AUS" };
  return checks.map((c) => `${label[c.status].padEnd(7)} ${c.label.padEnd(11)} ${c.text}`).join("\n") + "\n";
}

export function exitCodeFor(checks) {
  if (checks.some((c) => c.status === "stopp")) return EXIT.FAIL;
  if (checks.some((c) => c.status === "stumm")) return EXIT_SILENT;
  return EXIT.OK;
}

export const main = withExitCodes(async (argv, io, deps) => {
  const { values } = parseArgs({
    args: argv,
    options: {
      "min-free-gb": { type: "string" },
      "max-cargo": { type: "string" },
      usage: { type: "string" },
      cap: { type: "string" },
      "session-cap": { type: "string" },
      "observe-log": { type: "string" },
      "since-sec": { type: "string" },
      deps: { type: "boolean" },
      "max-behind": { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean" },
    },
    strict: true,
  });
  if (values.help) {
    io.out(HELP);
    return EXIT.OK;
  }
  const minFreeGb = values["min-free-gb"] === undefined ? DEFAULT_MIN_FREE_GB : number("--min-free-gb", values["min-free-gb"]);
  const maxCargo = values["max-cargo"] === undefined ? DEFAULT_MAX_CARGO : number("--max-cargo", values["max-cargo"], { integer: true });
  const cap = values.cap === undefined ? DEFAULT_CAP : number("--cap", values.cap);
  const sessionCap = values["session-cap"] === undefined ? DEFAULT_CAP : number("--session-cap", values["session-cap"]);
  if (values["since-sec"] !== undefined && !values["observe-log"]) throw new UsageError("--since-sec braucht --observe-log");
  if (values["max-behind"] !== undefined && !values.deps) throw new UsageError("--max-behind braucht --deps");
  const maxBehind = values["max-behind"] === undefined ? DEFAULT_MAX_BEHIND : number("--max-behind", values["max-behind"], { integer: true });
  const sinceSec = values["since-sec"] === undefined ? DEFAULT_SINCE_SEC : number("--since-sec", values["since-sec"]);

  const readFile = deps.readFile || realReadFile;
  let usage;
  let usageError;
  if (values.usage !== undefined) {
    const text = readFile(values.usage);
    if (text === null) usage = null;
    else {
      try {
        usage = parseUsage(text);
      } catch (e) {
        usageError = `Nutzungsdatei ${values.usage}: ${e.message}`;
      }
    }
  }

  const run = deps.run || makeRunner();
  const processes = deps.processes ? deps.processes() : listCargoProcesses({ run });
  const checks = [
    checkRam({ freeBytes: deps.freeBytes ? deps.freeBytes() : freemem(), minFreeGb }),
    checkCargo({ processes, maxCargo }),
    usageError ? check("limit", "Limit", "stopp", usageError) : checkUsage({ usage, cap, sessionCap, file: values.usage }),
    checkObserve({ stat: deps.stat || realStat, file: values["observe-log"], sinceSec, now: deps.now ? deps.now() : Date.now() }),
  ];
  if (values.deps) {
    const stat = deps.stat || realStat;
    checks.push(checkNodeModules({ stat }), checkCargoDeps({ run }), checkBehind({ run, maxBehind }));
  }
  const exit = exitCodeFor(checks);
  io.out(values.json ? JSON.stringify({ ok: exit === EXIT.OK, exit, checks }, null, 2) + "\n" : format(checks));
  return exit;
});

if (isMain(import.meta.url)) runCli(main);
