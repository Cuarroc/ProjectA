// Repository statistics for the HQ. Pure over injected inputs (git output,
// file lists, snapshot) so tests do not need a repository.

/// `git log --since=<n> days --format=%ad --date=short` output → daily counts,
/// oldest first, every day present (zeros included).
export function commitsPerDay(logOutput, days = 14, today = new Date()) {
  const counts = new Map();
  for (const line of String(logOutput || "").split(/\r?\n/)) {
    const day = line.trim();
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
