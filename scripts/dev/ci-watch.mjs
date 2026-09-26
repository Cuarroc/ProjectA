#!/usr/bin/env node
// SETUP-08a — ci-watch: follow the REQUIRED checks of one PR until they are
// done, with a bounded run time and an exit code that says how it ended.
// Polls `gh pr checks <pr> --required --json name,state,bucket,link`; gh's
// own exit code (8 = pending, 1 = failed) is not used, the JSON is.
//
//   npm run dev:ci-watch -- 123 [--timeout 60m] [--interval 30s] [--fail-fast]
import { parseArgs } from "node:util";
import { EXIT, UsageError, makeRunner, isMain, runCli, withExitCodes, parseDuration, SLEEP } from "../lib/dev-tools.mjs";

const HELP = `ci-watch — Required Checks eines PRs bis zum Abschluss verfolgen

Aufruf:
  npm run dev:ci-watch -- <pr-nummer> [Optionen]

Optionen:
  --timeout <dauer>   hoechstens so lange warten (Standard: 60m)
  --interval <dauer>  Abfrageabstand (Standard: 30s, mindestens 5s)
  --fail-fast         beim ersten roten Check aufhoeren
  --help              diese Hilfe

Exit-Codes: 0 alle Required Checks gruen (skipping zaehlt als erledigt),
            1 mindestens einer rot oder abgebrochen,
            2 Aufruffehler,
            3 gh-Fehler oder der PR bekommt keine Required Checks (z. B. Draft: keine CI),
            4 Zeitlimit erreicht, Checks laufen noch.
`;

const DONE_OK = new Set(["pass", "skipping"]);
const DONE_BAD = new Set(["fail", "cancel"]);

function fetchChecks(run, pr) {
  const r = run("gh", ["pr", "checks", pr, "--required", "--json", "name,state,bucket,link"]);
  const text = r.stdout.trim();
  if (!text.startsWith("[")) {
    // gh prints "no required checks reported" on stderr and exits 1 for a PR without checks
    if (/no (required )?checks reported/i.test(r.stderr)) return { checks: [] };
    return { error: (r.stderr || r.stdout || `gh Exit ${r.code}`).trim() };
  }
  try {
    return { checks: JSON.parse(text) };
  } catch {
    return { error: "gh lieferte keine gueltige JSON-Ausgabe" };
  }
}

function summarize(checks) {
  return checks.map((c) => `${c.name}: ${c.bucket}`).join(", ");
}

export async function watchChecks({ run, pr, timeoutMs = 3_600_000, intervalMs = 30_000, failFast = false, graceMs = 180_000, sleep = SLEEP, now = Date.now, log = () => {} }) {
  const start = now();
  let emptySince = null;
  let last = [];
  for (;;) {
    const res = fetchChecks(run, pr);
    if (res.error) return { code: EXIT.REFUSED, checks: last, summary: `gh: ${res.error}` };
    const checks = res.checks;
    last = checks;
    if (checks.length === 0) {
      // GitHub registers required checks (rulesets) only seconds to a minute
      // after push — the grace is a TIME budget, not a poll count (N4).
      if (emptySince === null) emptySince = now();
      if (now() - emptySince >= graceMs) {
        return { code: EXIT.REFUSED, checks, summary: `keine Required Checks nach ${Math.round(graceMs / 1000)} s Karenz (Draft-PR? Draft-PRs bekommen keine CI)` };
      }
    } else {
      emptySince = null;
      const bad = checks.filter((c) => DONE_BAD.has(c.bucket));
      const pending = checks.filter((c) => !DONE_OK.has(c.bucket) && !DONE_BAD.has(c.bucket));
      log(`[${Math.round((now() - start) / 1000)} s] ${summarize(checks)}\n`);
      if (bad.length && (failFast || pending.length === 0)) {
        return { code: EXIT.FAIL, checks, summary: `rot: ${bad.map((c) => `${c.name} (${c.link || c.state})`).join(", ")}` };
      }
      if (pending.length === 0) return { code: EXIT.OK, checks, summary: `gruen: ${summarize(checks)}` };
    }
    if (now() - start + intervalMs > timeoutMs) {
      return { code: EXIT.TIMEOUT, checks, summary: `Zeitlimit erreicht, noch offen: ${summarize(checks.filter((c) => !DONE_OK.has(c.bucket) && !DONE_BAD.has(c.bucket))) || "-"}` };
    }
    await sleep(intervalMs);
  }
}

export const main = withExitCodes(async (argv, io, deps) => {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      timeout: { type: "string" },
      interval: { type: "string" },
      "fail-fast": { type: "boolean" },
      help: { type: "boolean" },
    },
    allowPositionals: true,
    strict: true,
  });
  if (values.help) {
    io.out(HELP);
    return EXIT.OK;
  }
  const pr = positionals[0];
  if (!pr || !/^\d+$/.test(pr) || positionals.length > 1) throw new UsageError("genau eine PR-Nummer erwartet");
  const intervalMs = values.interval ? parseDuration(values.interval) : 30_000;
  if (intervalMs < 5000) throw new UsageError("--interval mindestens 5s");
  const res = await watchChecks({
    run: deps.run || makeRunner(),
    pr,
    timeoutMs: values.timeout ? parseDuration(values.timeout) : 3_600_000,
    intervalMs,
    failFast: Boolean(values["fail-fast"]),
    sleep: deps.sleep,
    now: deps.now,
    log: io.out,
  });
  (res.code === EXIT.OK ? io.out : io.err)(`PR #${pr}: ${res.summary}\n`);
  return res.code;
});

if (isMain(import.meta.url)) runCli(main);
