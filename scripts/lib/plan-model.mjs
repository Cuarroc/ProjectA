export const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim());
export const tableCells = (line) => cells(line).map((c) => c.replace(/\\\|/g, "|"));
// Column index of "Status" (old MASTERPLAN tables) or "Stand" (the milestone
// tables of docs/PLAN.md) when lines[i] is the header of such a table (first
// column "ID", separator row below), else -1.
export function statusColumn(lines, i) {
  if (!lines[i].startsWith("|") || !/^\|[-|: ]+\|\s*$/.test(lines[i + 1] || "")) return -1;
  const head = cells(lines[i]);
  if (head[0] !== "ID") return -1;
  const status = head.indexOf("Status");
  return status !== -1 ? status : head.indexOf("Stand");
}

const clean = (s) => s.replace(/`|\*\*/g, "").trim();
const ids = (s) => [...new Set(s.match(/\b[A-Z][A-Z0-9]*(?:-[A-Za-z0-9.]+)+\b/g) || [])];
// Dependency clauses start with an ID (or "Geplant nach"), not incidental prose mentions.
const dependencyTokens = (s) => [...new Set(s.split(/[,;→]/).flatMap((part) => clean(part).replace(/^(?:geplant\s+)?nach\s+/i, "").match(/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}.]+)*/u) || []))];
const finding = (kind, row, detail, pr) => ({ kind, id: row.id, pr, file: row.file, line: row.line, detail });
const historical = (p) => /erledigt|historisch/i.test(p.section);
function duplicates(packages) {
  const seen = new Set();
  return packages.filter((p) => !historical(p)).flatMap((p) => {
    if (seen.has(p.id)) return [finding("duplicate-id", p, "ID mehrfach vorhanden")];
    seen.add(p.id); return [];
  });
}
export function normalizeStatus(raw) {
  const text = clean(raw);
  const current = text.split(/;\s*(?:früher|historisch|ursprünglich|ersetzt:)/i)[0];
  if (/(?:✓|\b(?:gemergt|erledigt|done)\b)/i.test(current) && /\b(offen|geplant|planned|in Arbeit|in Prüfung|draft|ausstehend)\b/i.test(current)) return "in_progress";
  // "Angenommen" is an in-review alias documented in docs/PLAN.md, Statuswerte.
  for (const [pattern, status] of [
    [/^(gemergt|erledigt|done|✓)/i, "done"], [/^(PR #\d|in Prüfung|draft|ready|entwurf|angenommen)/i, "in_review"],
    [/^(läuft|in Arbeit|dispatched|in_progress)/i, "in_progress"], [/^(geplant|wartet|bereit|planned|offen)/i, "planned"],
    [/^(blockiert|blocked)/i, "blocked"], [/^(später|geparkt|verschoben|parked)/i, "parked"], [/^(entfällt|entfallen|gestrichen|dropped)/i, "dropped"],
  ]) if (pattern.test(text)) return status;
  return "unknown";
}
export function parsePlan(markdown, { file } = {}) {
  const packages = [], decisions = [], lines = markdown.split(/\r?\n/);
  let section = "", head = null, fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      head = null; continue;
    }
    if (fence) continue;
    const heading = line.match(/^#{1,4}\s+(.+)/);
    if (heading) section = heading[1];
    if (!line.trim().startsWith("|")) { head = null; continue; }
    const row = tableCells(line);
    if (/^\|[-|: ]+\|\s*$/.test(lines[i + 1] || "")) { head = row.map(clean); i++; continue; }
    if (!head) continue;
    const column = (pattern) => row[head.findIndex((h, index) => index > 0 && pattern.test(h))] ?? "";
    const statusRaw = column(/\b(status|stand)\b/i), id = clean(row[0]).replace(/^([A-Z][A-Z0-9]*(?:-[A-Za-z0-9.]+)+)\s+\(.*\)$/, "$1");
    if (head.some((h) => /frage|entscheidung/i.test(h)) && head.some((h) => /^(status|stand)$/i.test(h))) {
      decisions.push({ id, status: /^(beantwortet|entschieden|answered)/i.test(clean(statusRaw)) ? "answered" : "open", line: i + 1 });
      continue;
    }
    if (!/^(ID|Paket)$/i.test(head[0]) && !/^[A-Z][A-Z0-9]*(-[A-Za-z0-9.]+)+$/.test(id)) continue;
    packages.push({ id, title: clean(column(/^(Ziel|Was|Goal|Titel|Title|Inhalt|Paket)(\b|\s*\/)/i)), status: normalizeStatus(statusRaw), statusRaw,
      deps: dependencyTokens(column(/abhäng|voraussetzung|dep|hängt ab|^nach$/i)), version: column(/^version$/i) || undefined,
      direction: column(/^richtung$/i) || section, owner: column(/^(owner|wer)$/i) || undefined,
      prs: [...new Set([...line.matchAll(/#(\d+)\b/g)].map((m) => Number(m[1])))], file, line: i + 1, section });
  }
  const known = new Set(packages.map((p) => p.id));
  for (const p of packages) {
    // The v2 plan uses local shorthand; only source-defined targets may expand.
    p.deps = [...new Set(p.deps.map((id) => known.has(id) ? id : p.id.startsWith("V2-") && known.has(`V2-${id}`) ? `V2-${id}` : id))]
      .filter((id) => known.has(id) || /^[A-Z][A-Z0-9]*(?:-(?:[A-Z][A-Z0-9]*|\d+(?:[a-z]\d*)?))+$/u.test(id));
  }
  return { packages, decisions, problems: duplicates(packages) };
}

// Mirror src/screens/eingang/plan/planGraphModel.ts: self-reachability, then levels excluding cycle edges.
export function dependencyGraph(packages) {
  const edges = new Map(packages.map((p) => [p.id, p.deps]));
  const known = (id) => (edges.get(id) || []).filter((d) => edges.has(d));
  const cycle = [...edges.keys()].filter((id) => {
    const seen = new Set(), stack = [...known(id)];
    while (stack.length) {
      const next = stack.pop();
      if (next === id) return true;
      if (!seen.has(next)) { seen.add(next); stack.push(...known(next)); }
    }
    return false;
  }).sort();
  const levels = [], memo = new Map();
  const level = (id) => {
    if (!memo.has(id)) memo.set(id, Math.max(-1, ...known(id).filter((d) => !cycle.includes(d)).map(level)) + 1);
    return memo.get(id);
  };
  for (const id of [...edges.keys()].filter((id) => !cycle.includes(id)).sort()) (levels[level(id)] ??= []).push(id);
  return { cycle, levels };
}
function mentions(text, id, branch = false) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${branch ? "(?:^|/|-)" : "(?<![\\w.-])"}${escaped}${branch ? "(?=-|$)" : "(?![\\w.-])"}`, "i").test(text);
}
export function checkPlan(model, { prs = [], events = "", eventsFile = "events.log", decisions = "", decisionsFile = "docs/decisions.md", planText = "", lastPlanCommit, now = Date.now() } = {}) {
  const packages = model.packages, byId = new Map(packages.map((p) => [p.id, p]));
  const out = duplicates(packages), source = { file: "docs/PLAN.md", line: 1 };
  const namedByPr = new Map(prs.map((pr) => {
    const text = `${pr.title || ""}\n${(pr.body || "").match(/^Plan-ID:.*$/gmi)?.join("\n") || ""}`;
    return [pr, packages.filter((p) => mentions(text, p.id) || mentions(pr.headRefName || "", p.id, true))];
  }));
  const related = new Map(packages.map((p) => {
    // Missing referenced PRs keep closure unproven; dependency PRs describe other rows.
    const numbers = new Set([...p.statusRaw.matchAll(/#(\d+)\b/g)].map((m) => Number(m[1])));
    for (const pr of prs) if (namedByPr.get(pr).includes(p)) numbers.add(pr.number);
    return [p, [...numbers].map((number) => prs.find((pr) => pr.number === number))];
  }));
  for (const pr of prs) {
    const named = namedByPr.get(pr);
    if (pr.state === "OPEN" && /^(claude|codex|kimi|opencode|glm)\//.test(pr.headRefName || "") && !named.length) {
      out.push(finding("pr-without-plan-row", source, "Offener Paket-PR ohne Plan-ID", pr.number));
    }
    for (const p of packages.filter((p) => related.get(p).includes(pr))) {
      const pending = ["in_progress", "in_review", "planned"].includes(p.status);
      if ((pending && related.get(p).every((ref) => ["MERGED", "CLOSED"].includes(ref?.state))) || (p.status === "done" && pr.state === "OPEN")) {
        out.push(finding("status-contradicts-github", p, `${p.status} / GitHub ${pr.state}`, pr.number));
      }
    }
  }
  for (const p of packages) for (const dep of p.deps) if (!byId.has(dep)) out.push(finding("unknown-dependency", p, dep));
  for (const id of dependencyGraph(packages).cycle) out.push(finding("dependency-cycle", byId.get(id), "Paket ist Teil eines Zyklus"));
  const running = new Map();
  events.split(/\r?\n/).forEach((line, i) => {
    const m = line.match(/\b(JOB-START|FERTIG)\s+(\S+)/);
    if (!m) return;
    if (m[1] === "JOB-START") running.set(m[2], i + 1);
    else running.delete(m[2]);
  });
  for (const [label, line] of running) {
    const id = label.replace(/^(srv-|fix-|review-)+/i, "").replace(/-r\d+$/i, "");
    if (!packages.some((p) => p.id.toLowerCase() === id.toLowerCase())) out.push(finding("running-job-without-row", { id, file: eventsFile, line }, "Laufender Job ohne Planzeile"));
  }
  decisions.split(/\r?\n/).forEach((line, i) => {
    const m = line.match(/^## (\d{4}-\d{2}-\d{2}) [—–-] (.+)$/);
    if (!m || now - Date.parse(m[1]) < 0 || now - Date.parse(m[1]) > 14 * 86400000) return;
    const words = m[2].toLowerCase().match(/[\p{L}\p{N}-]{4,}/gu) || [];
    const referenced = ids(m[2]).some((id) => mentions(planText, id)) || (words.length && words.every((w) => planText.toLowerCase().includes(w)));
    if (!referenced) out.push(finding("decision-without-plan-row", { file: decisionsFile, line: i + 1 }, m[2]));
  });
  const last = Date.parse(lastPlanCommit);
  if (now - last > 12 * 3600000 && prs.filter((p) => p.state === "MERGED" && Date.parse(p.mergedAt) > last).length >= 5) out.push(finding("plan-stale", source, "Plan älter als 12 h; mindestens 5 PRs seither gemergt"));
  return out;
}
