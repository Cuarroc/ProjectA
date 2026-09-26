#!/usr/bin/env node
// SETUP-08a — build-slot: which Cargo target directory is free right now?
//
// Slots (MASTERPLAN "Worker-Struktur"): ~/cargo-targets/projecta-{a,b,c} and
// the main checkout's src-tauri/target; PA_BUILD_SLOTS ("pfad;pfad") replaces
// the list. A slot is busy when a cargo/rustc process names it on its command
// line (rustc always gets --out-dir/-L dependency=<target>/...); cargo's own
// environment (CARGO_TARGET_DIR) is not readable for other processes on
// Windows. Without a process list the fallback is a heuristic: the slot's
// debug/.cargo-lock or deps directory changed within the last two minutes.
//
// Free RAM comes from os.freemem() (available physical memory on Windows and
// Linux), so there is no localized "3,25" text to parse. At most three builds
// at once, never below 2.5 GB free. This tool never sets CARGO_PROFILE_*.
import { statSync } from "node:fs";
import { homedir, freemem, platform as osPlatform } from "node:os";
import { join, resolve, dirname } from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { EXIT, makeRunner, gitIn, isMain, runCli, withExitCodes } from "../lib/dev-tools.mjs";

export const MIN_FREE_GB = 2.5;
export const MAX_PARALLEL = 3;
const RECENT_MS = 120_000;
const CARGO_BASE_NAMES = ["cargo", "rustc", "clippy-driver", "cargo-nextest", "cargo-clippy", "rustdoc", "build-script-build"];

// The kernel truncates /proc/<pid>/comm to 15 characters, so a 15-character
// name that prefixes a known cargo tool counts as that tool (G4/N3):
// "build-script-build" (18) shows up as "build-script-bu".
export function isCargoProcessName(name) {
  const n = String(name || "").trim().replace(/\.exe$/i, "").toLowerCase();
  if (CARGO_BASE_NAMES.includes(n)) return true;
  return n.length === 15 && CARGO_BASE_NAMES.some((base) => base.startsWith(n));
}

const HELP = `build-slot — freien Cargo-Build-Slot finden

Aufruf:
  npm run dev:build-slot -- [--json]

Slots: ~/cargo-targets/projecta-{a,b,c} und <Hauptcheckout>/src-tauri/target
       (PA_BUILD_SLOTS="pfad;pfad" ersetzt die Liste).
Belegt: ein cargo/rustc-Prozess nennt den Slot in seiner Kommandozeile;
        ohne Prozessliste: .cargo-lock/deps juenger als 2 min (Heuristik).
Regeln: hoechstens ${MAX_PARALLEL} Builds gleichzeitig, mindestens ${MIN_FREE_GB} GB freier RAM.

Exit-Codes: 0 Empfehlung vorhanden, 3 jetzt kein Slot (warten), 2 Aufruffehler.
Setzt nie CARGO_PROFILE_* (das invalidiert den Cache).
`;

export function defaultSlots({ home = homedir(), mainCheckout, env = process.env }) {
  if (env.PA_BUILD_SLOTS) {
    return env.PA_BUILD_SLOTS.split(";")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => ({ name: p.split(/[\\/]/).filter(Boolean).pop(), path: p }));
  }
  const slots = ["a", "b", "c"].map((x) => ({ name: `projecta-${x}`, path: join(home, "cargo-targets", `projecta-${x}`).replace(/\\/g, "/") }));
  if (mainCheckout) slots.push({ name: "main", path: join(mainCheckout, "src-tauri", "target").replace(/\\/g, "/") });
  return slots;
}

function normPath(p, platform) {
  const n = String(p).replace(/\\/g, "/").replace(/\/+$/, "");
  return platform === "win32" ? n.toLowerCase() : n;
}

// A command line names the slot when the slot path appears followed by a
// path separator or the end of a token (so projecta-a never matches projecta-ab).
export function namesSlot(cmd, slotPath, platform) {
  const c = normPath(cmd, platform);
  const s = normPath(slotPath, platform);
  let i = c.indexOf(s);
  while (i !== -1) {
    const next = c[i + s.length];
    if (next === undefined || next === "/" || next === " " || next === '"' || next === "'") return true;
    i = c.indexOf(s, i + 1);
  }
  return false;
}

// Freshness of lock/deps/fingerprint, across the profiles cargo writes to
// (debug AND release — N2). Used as the only signal without a process list,
// and as a second signal with one (M3: between two rustc invocations no
// process names the slot, e.g. during dependency resolution or linking).
function freshestProbe(stat, slotPath) {
  const probes = ["debug", "release"].flatMap((profile) => [
    join(slotPath, profile, ".cargo-lock"),
    join(slotPath, profile, "deps"),
    join(slotPath, profile, ".fingerprint"),
  ]);
  return Math.max(0, ...probes.map((p) => stat(p)).filter((x) => x.exists).map((x) => x.mtimeMs));
}

export function slotStatus({ slots, processes, freeBytes, stat, now = Date.now(), platform = osPlatform() }) {
  const cargo = processes ? processes.filter((p) => isCargoProcessName(p.name)) : null;
  const attributed = new Set();
  const out = slots.map((slot) => {
    const s = stat(slot.path);
    if (!s.exists) return { ...slot, state: "fehlt", reason: "Verzeichnis nicht vorhanden (kalter Slot)" };
    const newest = freshestProbe(stat, slot.path);
    const freshSecs = newest ? Math.round((now - newest) / 1000) : null;
    if (cargo) {
      const hits = cargo.filter((p) => namesSlot(p.cmd || "", slot.path, platform));
      hits.forEach((p) => attributed.add(p.pid));
      if (hits.length) return { ...slot, state: "belegt", reason: `${hits.length} Prozess(e): ${[...new Set(hits.map((p) => p.name))].join(", ")}` };
      if (freshSecs !== null && freshSecs * 1000 < RECENT_MS) {
        return { ...slot, state: "vermutlich belegt", reason: `kein Prozess nennt den Slot, aber vor ${freshSecs} s geaendert (Startphase/Linken?)` };
      }
      return { ...slot, state: "frei", reason: "kein cargo/rustc-Prozess nennt diesen Slot" };
    }
    if (freshSecs !== null && freshSecs * 1000 < RECENT_MS) {
      return { ...slot, state: "vermutlich belegt", reason: `Heuristik: vor ${freshSecs} s geaendert` };
    }
    return { ...slot, state: "frei", reason: "Heuristik: seit > 2 min unveraendert (Prozessliste nicht verfuegbar)" };
  });
  const freeGb = freeBytes / 1024 ** 3;
  const unattributed = cargo ? cargo.filter((p) => !attributed.has(p.pid)).length : null;
  // Unattributed cargo processes count conservatively toward the parallel
  // limit (M3): a build whose processes do not name a slot still builds.
  const busy = out.filter((s) => s.state === "belegt" || s.state === "vermutlich belegt").length + (unattributed || 0);
  const free = out.filter((s) => s.state === "frei");
  let recommendation;
  if (freeGb < MIN_FREE_GB) {
    recommendation = { slot: null, text: `warten: nur ${freeGb.toFixed(1)} GB freier RAM (< ${MIN_FREE_GB} GB)`, env: "" };
  } else if (busy >= MAX_PARALLEL) {
    recommendation = { slot: null, text: `warten: schon ${busy} Builds aktiv (hoechstens drei gleichzeitig)`, env: "" };
  } else if (!free.length) {
    recommendation = { slot: null, text: "warten: kein freier Slot", env: "" };
  } else {
    const slot = free[0];
    recommendation = {
      slot,
      text: `${slot.name} verwenden`,
      env: `CARGO_TARGET_DIR=${slot.path} CARGO_BUILD_JOBS=${busy >= 1 || freeGb < 6 ? 1 : 2}`,
    };
  }
  return { slots: out, freeGb: Math.round(freeGb * 10) / 10, busy, unattributed, source: cargo ? "prozesse" : "heuristik", recommendation };
}

// `Get-CimInstance ... | ConvertTo-Json` prints one object for one match.
export function parseWindowsProcesses(text) {
  const t = String(text || "").trim();
  if (!t) return [];
  const data = JSON.parse(t);
  return (Array.isArray(data) ? data : [data]).map((p) => ({ pid: p.ProcessId, name: p.Name || "", cmd: p.CommandLine || "" }));
}

function listLinuxProcesses() {
  const out = [];
  for (const pid of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
    try {
      const name = readFileSync(`/proc/${pid}/comm`, "utf8").trim();
      if (!isCargoProcessName(name)) continue;
      const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").join(" ");
      let envDir = "";
      try {
        const env = readFileSync(`/proc/${pid}/environ`, "utf8").split("\0");
        envDir = (env.find((e) => e.startsWith("CARGO_TARGET_DIR=")) || "").slice(17);
      } catch {
        /* other user's process */
      }
      out.push({ pid: Number(pid), name, cmd: envDir ? `${cmd} ${envDir}/` : cmd });
    } catch {
      /* process ended */
    }
  }
  return out;
}

// null = could not determine (then the heuristic is used)
export function listCargoProcesses({ run, platform = osPlatform() }) {
  try {
    if (platform === "win32") {
      const filter = "Name='cargo.exe' OR Name='rustc.exe' OR Name='clippy-driver.exe' OR Name='cargo-nextest.exe' OR Name='cargo-clippy.exe' OR Name='rustdoc.exe' OR Name='build-script-build.exe'";
      const r = run("powershell", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Get-CimInstance Win32_Process -Filter "${filter}" | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress`,
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
    return { exists: true, mtimeMs: s.mtimeMs };
  } catch {
    return { exists: false };
  }
}

function mainCheckoutOf(run, cwd) {
  const git = gitIn(run, cwd);
  const r = git("rev-parse", "--path-format=absolute", "--git-common-dir");
  if (r.code !== 0) return null;
  return dirname(r.stdout.trim());
}

function format(s) {
  const lines = [`Freier RAM: ${s.freeGb} GB · aktive Builds: ${s.busy} · Quelle: ${s.source}`];
  for (const x of s.slots) lines.push(`  ${x.state.padEnd(17)} ${x.name.padEnd(11)} ${x.path}  (${x.reason})`);
  if (s.unattributed) lines.push(`  Hinweis: ${s.unattributed} cargo/rustc-Prozess(e) ohne Slot in der Kommandozeile (z. B. cargo selbst in der Startphase)`);
  lines.push(`Empfehlung: ${s.recommendation.text}`);
  if (s.recommendation.env) lines.push(`  ${s.recommendation.env}`);
  return lines.join("\n") + "\n";
}

export const main = withExitCodes(async (argv, io, deps) => {
  const { values } = parseArgs({ args: argv, options: { json: { type: "boolean" }, help: { type: "boolean" } }, strict: true });
  if (values.help) {
    io.out(HELP);
    return EXIT.OK;
  }
  const run = deps.run || makeRunner();
  const slots = deps.slots || defaultSlots({ mainCheckout: mainCheckoutOf(run, resolve(process.cwd())) });
  const s = slotStatus({
    slots,
    processes: deps.processes ? deps.processes() : listCargoProcesses({ run }),
    freeBytes: deps.freeBytes ? deps.freeBytes() : freemem(),
    stat: deps.stat || realStat,
    now: deps.now ? deps.now() : Date.now(),
  });
  io.out(values.json ? JSON.stringify(s, null, 2) + "\n" : format(s));
  return s.recommendation.slot ? EXIT.OK : EXIT.REFUSED;
});

if (isMain(import.meta.url)) runCli(main);
