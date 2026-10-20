import { parsePlan, checkPlan, statusColumn } from "./plan-model.mjs";

export function syncPlan(markdown, prs) {
  const model = parsePlan(markdown), changes = [], skipped = [];
  const parts = markdown.split(/(\r?\n)/), lines = markdown.split(/\r?\n/);
  const groups = new Map();
  for (const f of checkPlan(model, { prs })) {
    if (f.kind !== "status-contradicts-github") continue;
    if (!groups.has(f.line)) groups.set(f.line, []);
    groups.get(f.line).push(f.pr);
  }
  for (const row of model.packages) {
    if (!groups.has(row.line)) continue;
    const skip = reason => skipped.push({ id: row.id, line: row.line, reason });
    const numbers = [...new Set(groups.get(row.line))].sort((a, b) => a - b);
    const refs = numbers.map(n => prs.find(pr => pr.number === n));
    if (/^Erledigt\b/i.test(row.statusRaw.replace(/`|\*\*/g, "").trim()) || !["in_progress", "in_review", "planned"].includes(row.status) || refs.some(pr => pr?.state !== "MERGED")) {
      skip("Not a pending row with all referenced PRs merged"); continue;
    }
    if (refs.some(pr => !/^\d{4}-\d{2}-\d{2}T/.test(pr.mergedAt || "") || !Number.isFinite(Date.parse(pr.mergedAt)))) {
      skip("Missing or invalid merge date"); continue;
    }
    const prefix = `Erledigt: ${refs.map(pr => `#${pr.number} (merged ${new Date(pr.mergedAt).toISOString().slice(0, 10)})`).join(", ")}`;
    let column = -1;
    for (let i = row.line - 2; i >= 0 && lines[i].startsWith("|"); i--) {
      column = statusColumn(lines, i);
      if (column >= 0) break;
    }
    if (column < 0) { skip("No dedicated Status or Stand column"); continue; }
    const cells = lines[row.line - 1].split(/(?<!\\)\|/);
    const old = cells[column + 1].trim(), next = `${prefix}; ursprünglich: ${old}`;
    cells[column + 1] = cells[column + 1].replace(/\S(?:[\s\S]*\S)?/, () => next);
    parts[(row.line - 1) * 2] = cells.join("|");
    changes.push({ id: row.id, line: row.line, old, new: next });
  }
  return { markdown: parts.join(""), changes, skipped };
}
