// Insights for the Dev HQ: what is significant right now, and honest
// estimates of the whole project's time and token consumption. Pure over
// injected inputs (git output, ACTIVITY.md text, live API payloads) so
// node:test can drive it; scripts/hq-live.mjs supplies the real inputs.

const HOUR = 3600;

/// `git log --format=%at` (newest first or any order) → clusters of commits
/// closer than `gapMinutes` apart. Each cluster is one sitting; a lone
/// commit still counts the lead-up work (`leadMinutes`).
export function workSessions(timestamps, { gapMinutes = 90, leadMinutes = 30 } = {}) {
  const ts = [...new Set((timestamps || []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  const sessions = [];
  for (const t of ts) {
    const last = sessions.at(-1);
    if (last && t - last.end <= gapMinutes * 60) {
      last.end = t;
      last.commits += 1;
    } else {
      sessions.push({ start: t, end: t, commits: 1 });
    }
  }
  for (const s of sessions) s.hours = Math.round(((s.end - s.start + leadMinutes * 60) / HOUR) * 100) / 100;
  return { sessions, hours: Math.round(sessions.reduce((a, s) => a + s.hours, 0) * 10) / 10, commits: ts.length };
}

/// `.pa/ACTIVITY.md` journal headings `## YYYY-MM-DD HH:MM — instance (…)`
/// → one entry per agent session end.
export function activitySessions(text) {
  const out = [];
  for (const m of String(text || "").matchAll(/^## (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) — ([^\n(]+)/gm)) {
    out.push({ day: m[1], time: m[2], instance: m[3].trim() });
  }
  return out;
}

/// `git log --shortstat --format=%at` → { insertions, deletions } excluding
/// generated or vendored paths is not possible from shortstat, so callers
/// pass `--numstat` output and we skip known generated files here.
export function diffVolume(numstatOutput, generatedPattern = /(^|\/)(data\.js|data\.json|package-lock\.json|Cargo\.lock|fonts\/)/) {
  let insertions = 0;
  let deletions = 0;
  for (const line of String(numstatOutput || "").split(/\r?\n/)) {
    const m = /^(\d+)\t(\d+)\t(.+)$/.exec(line);
    if (!m || generatedPattern.test(m[3])) continue;
    insertions += Number(m[1]);
    deletions += Number(m[2]);
  }
  return { insertions, deletions };
}

/// Two estimates with their basis spelled out. Tokens prefer the real
/// ledger when the router has one; the heuristic otherwise: every changed
/// line costs ~10 tokens to write and an agent reads ~6× what it writes
/// (context, retries, reviews). Time is the larger of git sittings and
/// journal sessions × a median 45-minute sitting.
export function estimateEffort({ git, activity, volume, ledger }) {
  const changed = (volume?.insertions || 0) + (volume?.deletions || 0);
  const heuristicTokens = changed * 10 * 6;
  const ledgerTokens = ledger && Number.isFinite(ledger.tokensIn + ledger.tokensOut) ? ledger.tokensIn + ledger.tokensOut : null;
  const tokens = ledgerTokens && ledgerTokens > heuristicTokens
    ? { value: ledgerTokens, low: ledgerTokens, high: ledgerTokens, source: "ledger", basis: "OmniRoute usage ledger, all time (tokens in + out)" }
    : {
        value: heuristicTokens,
        low: ledgerTokens ? Math.max(ledgerTokens, Math.round(heuristicTokens * 0.5)) : Math.round(heuristicTokens * 0.5),
        high: Math.round(heuristicTokens * 2),
        source: ledgerTokens ? "heuristic+ledger" : "heuristic",
        basis: `${changed.toLocaleString("en-US")} changed lines × 10 tokens × 6 read/write ratio${ledgerTokens ? `; ledger so far ${ledgerTokens.toLocaleString("en-US")}` : "; no router ledger available"}`,
      };
  const gitHours = git?.hours || 0;
  const journalHours = Math.round(((activity?.length || 0) * 0.75) * 10) / 10;
  const value = Math.max(gitHours, journalHours);
  const time = {
    hours: value,
    low: Math.round(Math.min(gitHours, journalHours) * 10) / 10 || value,
    high: Math.round((gitHours + journalHours) * 10) / 10,
    days: Math.round((value / 8) * 10) / 10,
    basis: `${git?.sessions?.length || 0} git sittings (${gitHours} h, commits ≤ 90 min apart + 30 min lead) vs ${activity?.length || 0} journal sessions × 45 min (${journalHours} h); shown: the larger`,
  };
  return { tokens, time, costUsd: ledger?.costUsd ?? null };
}

/// 7 × 24 commit counts (weekday rows, hour columns, UTC).
export function heatmap(timestamps) {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  let max = 0;
  for (const t of timestamps || []) {
    const d = new Date(Number(t) * 1000);
    if (Number.isNaN(d.getTime())) continue;
    const row = (d.getUTCDay() + 6) % 7; // Monday first
    grid[row][d.getUTCHours()] += 1;
    max = Math.max(max, grid[row][d.getUTCHours()]);
  }
  return { grid, max };
}

/// Ranked "what matters now". Each signal: level (act | watch | note),
/// title, why, and where to act. Deterministic and cheap; the live page
/// posts its already-loaded payloads.
export function significantSignals(ctx = {}) {
  const out = [];
  const board = ctx.board || [];
  const push = (level, title, why, target) => out.push({ level, title, why, target });

  for (const row of board) {
    const w = row.worker || row;
    if (row.column === "needs_you" || row.attentionReason) push("act", `${w.task || w.id} needs a human`, row.attentionReason || "the worker is waiting for input", `worker:${w.id}`);
    if (row.column === "ready_to_merge") push("act", `${w.task || w.id} is ready to merge`, row.testStatus ? `tests ${row.testStatus}` : "verdict recorded", `worker:${w.id}`);
    if (row.contextUsage?.total && row.contextUsage.used / row.contextUsage.total >= 0.8) push("watch", `${w.task || w.id} is at ${Math.round((row.contextUsage.used / row.contextUsage.total) * 100)}% context`, "a context reset or hand-over is due before it degrades", `worker:${w.id}`);
    if (row.testStatus && /fail|error/i.test(String(row.testStatus))) push("act", `${w.task || w.id} has failing tests`, `tests ${row.testStatus}`, `worker:${w.id}`);
  }
  for (const q of ctx.questions || []) push("act", `Open question: ${q.question || q.text || q.id}`, `from ${q.workerId || "preflight"}`, `question:${q.id}`);
  for (const q of ctx.quota || []) if (q.state === "blocked") push("watch", `${q.profileId} is quota-blocked`, `${q.reason || "rate limit"}${q.blockedUntil ? ` until ${new Date(q.blockedUntil * 1000).toLocaleTimeString()}` : ""}`, "capacity");
  for (const b of ctx.budgets || []) {
    if (Number.isFinite(b.fiveHourPct) && b.fiveHourPct >= 80) push("watch", `${b.profileId} 5-hour budget at ${b.fiveHourPct}%`, "spawns will fall back or stop at the limit", "capacity");
    if (Number.isFinite(b.sevenDayPct) && b.sevenDayPct >= 80) push("watch", `${b.profileId} 7-day budget at ${b.sevenDayPct}%`, "plan the week's heavy work accordingly", "capacity");
  }
  for (const p of ctx.providers || []) if (p.connected === false && p.kind !== "free_tier") push("watch", `${p.id} is not connected`, "workers on this profile cannot start", "providers");
  const queued = (ctx.queue || []).filter((e) => e.status === "queued" || !e.status).length;
  if (queued >= 5) push("watch", `${queued} tasks queued`, "the dispatcher will spawn them as capacity frees up — check the order", "queue");
  const disputed = (ctx.lessons || []).filter((l) => (l.failed || 0) > (l.worked || 0));
  if (disputed.length) push("note", `${disputed.length} lesson${disputed.length === 1 ? "" : "s"} disputed`, `the recorded fix failed more often than it helped: ${disputed.slice(0, 2).map((l) => l.id).join(", ")}`, "lessons");
  const recurring = (ctx.lessons || []).filter((l) => (l.hits || 1) >= 3).sort((a, b) => (b.hits || 0) - (a.hits || 0));
  if (recurring.length) push("note", `Most recurring error: ${recurring[0].symptom}`, `seen ${recurring[0].hits}× — worth a permanent fix, not another workaround`, "lessons");
  if (ctx.setup && !ctx.setup.ready) push("act", "This machine is not set up", ctx.setup.summary, "setup");
  if (ctx.stats?.commitsPerDay) {
    const last7 = ctx.stats.commitsPerDay.slice(-7).reduce((a, d) => a + d.commits, 0);
    const prev7 = ctx.stats.commitsPerDay.slice(-14, -7).reduce((a, d) => a + d.commits, 0);
    if (prev7 && last7 < prev7 / 2) push("note", "Commit pace halved this week", `${last7} vs ${prev7} commits the week before`, "stats");
  }
  if (ctx.snapshot?.specs?.locked >= 1 && ctx.snapshot?.specs?.startable === 0) push("watch", "Every active spec is locked", "the serial lane blocks all work — merge or unlock first", "next");
  if (ctx.dirtyFiles > 0) push("note", `${ctx.dirtyFiles} uncommitted file${ctx.dirtyFiles === 1 ? "" : "s"} in the checkout`, "the snapshot may not match the branch", "sources");

  const rank = { act: 0, watch: 1, note: 2 };
  out.sort((a, b) => rank[a.level] - rank[b.level]);
  if (!out.length) push("note", "Nothing needs you right now", "no attention, verdicts, quota blocks or disputed lessons", "");
  return out;
}
