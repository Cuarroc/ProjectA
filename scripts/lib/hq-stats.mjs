// Repository statistics for the HQ. Pure over injected inputs (git output,
// file lists, snapshot) so tests do not need a repository.

/// `git log --since=<n> days --format=%at` output (epochs; ISO days also work)
/// → daily UTC counts, oldest first, every day present (zeros included).
export function commitsPerDay(logOutput, days = 14, today = new Date()) {
  const counts = new Map();
  for (const line of String(logOutput || "").split(/\r?\n/)) {
    let day = line.trim();
    // `%at` epochs are bucketed in UTC; `--date=short` would use the author's zone.
    if (/^\d{9,}$/.test(day)) day = new Date(Number(day) * 1000).toISOString().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) counts.set(day, (counts.get(day) || 0) + 1);
  }
  const series = [];
  const base = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base.getTime() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    series.push({ day: key, commits: counts.get(key) || 0 });
  }
  return series;
}

/// `git shortlog -sn --since=...` output → [{ author, commits }].
export function authors(shortlogOutput, limit = 6) {
  return String(shortlogOutput || "")
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(\d+)\s+(.+)$/))
    .filter(Boolean)
    .map((m) => ({ author: m[2].trim(), commits: Number(m[1]) }))
    .sort((a, b) => b.commits - a.commits)
    .slice(0, limit);
}

/// Test surface from the tracked file list plus Rust `#[test]` count.
export function testSurface(files, rustTestCount = 0) {
  const isTest = (f) => /\.(test|spec)\.(ts|tsx|mjs|js)$/.test(f) || /\.browser\.mjs$/.test(f) || /(^|\/)(test|tests|__tests__)\//.test(f);
  const frontend = files.filter((f) => /\.(ts|tsx|mjs|js)$/.test(f) && isTest(f)).length;
  const rustFiles = files.filter((f) => f.endsWith(".rs")).length;
  return { frontendTestFiles: frontend, rustFiles, rustTests: rustTestCount };
}

/// What the snapshot already knows: findings by class, specs by lane/lock,
/// milestone packages (docs/PLAN.md) by state.
export function snapshotStats(snapshot) {
  const findings = snapshot?.findings || [];
  const specs = snapshot?.specs || [];
  const packages = (snapshot?.milestones || []).flatMap((m) => m.packages);
  const byKlass = {};
  for (const f of findings) byKlass[f.klass || "UNKNOWN"] = (byKlass[f.klass || "UNKNOWN"] || 0) + 1;
  const byState = {};
  for (const p of packages) byState[p.state || "unknown"] = (byState[p.state || "unknown"] || 0) + 1;
  return {
    findings: { total: findings.length, ...byKlass },
    specs: {
      total: specs.length,
      serial: specs.filter((s) => s.lane === "serial").length,
      parallel: specs.filter((s) => s.lane !== "serial").length,
      startable: specs.filter((s) => s.startable !== false).length,
      locked: specs.filter((s) => s.startable === false).length,
    },
    packages: { total: packages.length, ...byState },
  };
}

/// Fleet distribution from /api/board rows.
export function fleetStats(board) {
  const columns = {};
  let ctxUsed = 0;
  let ctxTotal = 0;
  for (const row of board || []) {
    const col = row.column || row.worker?.status || "unknown";
    columns[col] = (columns[col] || 0) + 1;
    if (row.contextUsage?.total) {
      ctxUsed += row.contextUsage.used || 0;
      ctxTotal += row.contextUsage.total;
    }
  }
  return { workers: (board || []).length, columns, contextPercent: ctxTotal ? Math.round((ctxUsed / ctxTotal) * 100) : null };
}

/// Remaining-work estimate from the number of startable specs. `null` means the
/// snapshot is unknown: no hours are shown instead of an invented minimum.
export function remainingEstimate(remainingSpecs) {
  if (!Number.isInteger(remainingSpecs)) {
    return { hours: null, label: "unknown", basis: "no specification snapshot available; no estimate is shown" };
  }
  const hours = remainingSpecs * 4;
  const label = hours === 0 ? "nothing remaining" : hours < 8 ? "under one focused day" : `${Math.ceil(hours / 8)} focused days`;
  return { hours, label, basis: "heuristic: 4 focused hours per startable specification; excludes blocked/serial wait time" };
}

/// Checkout freshness traffic light. `behind` = commits on origin/main that HEAD
/// lacks (`null` when the ref is missing), `standAgeH` = hours since the last
/// fetch (`null` when FETCH_HEAD is missing). Yellow from 1 commit behind or a
/// fetch older than 24 h, red from 50 behind. Text is plain German for the UI.
/// Hours since FETCH_HEAD was written. `gitPath` is the (already resolved) path
/// or "" when `git rev-parse` failed: never stat an empty path (it would resolve
/// to the repo root). Only a missing file means "never fetched"; other errors
/// are rethrown so the caller cannot mislabel them.
export function fetchHeadAgeH(gitPath, { stat, now = Date.now() }) {
  if (!gitPath) return null;
  try {
    return Math.max(0, (now - stat(gitPath).mtimeMs) / 3600000);
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

export function freshness({ behind = null, standAgeH = null } = {}) {
  if (!Number.isInteger(behind)) {
    return { level: "unbekannt", text: "Stand unbekannt: Der Vergleich mit origin/main ist hier nicht möglich." };
  }
  const stale = typeof standAgeH === "number" && standAgeH > 24;
  const age = standAgeH == null ? " Zuletzt geholt: unbekannt (nie geholt?)." : ` Zuletzt geholt vor ${Math.round(standAgeH)} Std.`;
  if (behind >= 50) return { level: "rot", text: `Dieser Stand liegt ${behind} Änderungen hinter origin/main. Bitte \`git pull\` ausführen.${age}` };
  if (behind >= 1) return { level: "gelb", text: `Dieser Stand liegt ${behind} Änderung${behind === 1 ? "" : "en"} hinter origin/main. Bald \`git pull\` ausführen.${age}` };
  if (stale) return { level: "gelb", text: `Auf dem Stand von origin/main, aber der letzte Abruf ist älter als 24 Std. Erst \`git fetch\` ausführen.${age}` };
  if (standAgeH == null) return { level: "gelb", text: `Auf dem Stand von origin/main, aber der letzte Abruf ist unbekannt. Erst \`git fetch\` ausführen.${age}` };
  return { level: "grün", text: `Dieser Stand ist auf der Höhe von origin/main.${age}` };
}
