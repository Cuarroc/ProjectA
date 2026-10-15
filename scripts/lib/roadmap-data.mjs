import { parsePlan, dependencyGraph } from "./plan-model.mjs";

const DAY = 86400000, UNKNOWN = "Unbekannt";
const human = (owner) => /\b(Nutzer|du)\b/i.test(owner || "");
const who = (owner) => human(owner) ? "du" : /\bRoot\b/i.test(owner || "") ? "Root" : owner ? "Worker" : UNKNOWN;
// Project only public fields; free-form infrastructure prose is deliberately withheld.
const publicText = (s) => !s || /https?:|\b(?:server|host|quota|kosten|costs|kontingent|srv-)|[€$]|\b\d+(?:\.\d+){3}\b|\.(?:invalid|internal|local|com|net|org)\b|\/home\/|[A-Z]:\\Users/i.test(s) ? UNKNOWN : s;
const planNames = { planned: "Geplant", in_progress: "In Arbeit", in_review: "In Prüfung", done: "Erledigt", blocked: "Blockiert", parked: "Verschoben", dropped: "Entfallen" };
const version = (s) => /^v?\d+\.\d+\.\d+$/.test(s || "") ? `v${s.replace(/^v/, "")}` : null;
const compareVersions = (a, b) => a.localeCompare(b, "en", { numeric: true });
const label = (pr, name) => pr?.labels?.some(l => (l.name || l) === name);
const closed = (p) => ["done", "dropped"].includes(p.status);
// The four seams of AGENTS.md rule 6, as full repo paths in a title.
const SEAM_PATH = /(?<![\w-])src-tauri\/src\/(?:(?:api|main|store)\.rs(?!\w)|store\/|bin\/pa\.rs(?!\w))/;
// Defining rows carry a status; description tables repeat the ID without one.
const defining = (p) => p.status !== "unknown" || Boolean(p.statusRaw);
function observedState(p, pr, now) {
  // An umbrella Plan-ID spans several PRs, so one merged PR finishes the package only if PLAN agrees.
  if (pr?.state === "MERGED") return closed(p) ? "Erledigt" : null;
  if (pr?.state !== "OPEN") return null;
  const checks = (pr.statusCheckRollup || []).filter(c => c.isRequired === true);
  const outcome = (c) => c.conclusion || c.state || c.status;
  if (label(pr, "conflict") || pr.mergeable === "CONFLICTING" || checks.some(c => /^(FAILURE|ERROR|CANCELLED|TIMED_OUT|ACTION_REQUIRED|STARTUP_FAILURE)$/.test(outcome(c)))) return "Fehler";
  if (label(pr, "do-not-merge") || human(p.owner)) return "Braucht dich";
  if (!pr.isDraft && checks.length && checks.every(c => /^(SUCCESS|NEUTRAL|SKIPPED)$/.test(outcome(c))) && label(pr, "review-ok")) return "Bereit zum Mergen";
  if (!pr.isDraft && checks.some(c => /^(PENDING|QUEUED|IN_PROGRESS|WAITING|REQUESTED|EXPECTED)$/.test(outcome(c)))) return "In Prüfung";
  const last = Math.max(...(pr.commits || []).map(c => Date.parse(c.committedDate)));
  if (pr.isDraft && now >= last && now - last < 2 * DAY) return "Läuft";
  return null;
}
function matched(pr, rows) {
  const explicit = [...(pr.body || "").matchAll(/^Plan-ID:[ \t]*([^\r\n]+)$/gmi)].map(m => m[1].trim().toLowerCase());
  if (explicit.length) return rows.filter(p => explicit.includes(p.id.toLowerCase()));
  const branch = (pr.headRefName || "").toLowerCase();
  return rows.filter(p => new RegExp(`(?:^|/|-)${p.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=-|$)`, "i").test(branch)).sort((a, b) => b.id.length - a.id.length).slice(0, 1);
}
function forecast(rows, all, now) {
  const open = rows.filter(p => !p.finished), seen = new Set();
  const unsafe = (p) => {
    if (!p) return true;
    if (p.finished || seen.has(p.id)) return false;
    seen.add(p.id);
    return p.seam || p.deps.some(id => unsafe(all.find(d => d.id === id)));
  };
  const recent = rows.filter(p => p.finished && p.mergedAt && now >= Date.parse(p.mergedAt) && now - Date.parse(p.mergedAt) < 7 * DAY);
  if (recent.length < 10 || open.some(unsafe)) return "zu wenig Daten";
  const dailyMerges = Array(7).fill(0);
  for (const p of recent) dailyMerges[Math.floor((now - Date.parse(p.mergedAt)) / DAY)]++;
  const active = dailyMerges.filter(n => n > 0);
  // Best observed day to slowest active day, scaled by observed idle-day share.
  return { fromDays: Math.ceil(open.length / Math.max(...active)), toDays: Math.ceil(open.length * 7 / (Math.min(...active) * active.length)), label: "Prognose, keine Zusage", merged: recent.length, dailyMerges };
}
/** plan accepts parsePlan's model or Markdown; PR checks must carry isRequired. */
export function buildRoadmap({ plan, prs = [], releases = [], now, mainSha }) {
  const time = new Date(now).getTime(), model = typeof plan === "string" ? parsePlan(plan) : plan;
  if (!Number.isFinite(time)) throw new Error("Invalid generation time");
  const defined = new Set(model.packages.filter(defining).map(p => p.id)), byId = new Map();
  for (const p of model.packages) {
    // A description-only row never replaces (or outlives) the row that defines the package; the last defining row wins.
    if (!/historisch|erledigt/i.test(p.section || "") && (defining(p) || !defined.has(p.id))) byId.set(p.id, p);
  }
  const rows = [...byId.values()], known = new Set(byId.keys());
  const links = new Map(rows.map(p => [p.id, []]));
  for (const pr of prs) for (const p of matched(pr, rows)) links.get(p.id).push(pr);
  const graph = dependencyGraph(rows);
  const packages = rows.map(p => {
    const related = links.get(p.id).filter(pr => pr.state !== "CLOSED").sort((a, b) => Number(b.state === "OPEN") - Number(a.state === "OPEN") || b.number - a.number);
    const pr = related[0], state = observedState(p, pr, time);
    const finished = state === "Erledigt" || (!pr && closed(p));
    return { id: p.id, title: publicText(p.title), owner: who(p.owner), deps: p.deps, unresolvedDeps: p.deps.filter(id => !known.has(id)),
      direction: publicText(p.direction && p.direction !== p.section ? p.direction : p.id.split("-")[0]),
      provisional: !p.direction || p.direction === p.section, version: version(p.version) || UNKNOWN,
      state, planStatus: `laut PLAN: ${planNames[p.status] || UNKNOWN}`, pr: pr?.number ?? null,
      open: pr?.state === "OPEN", finished, parked: p.status === "parked",
      blocker: !finished && (state === "Fehler" || p.status === "blocked"),
      seam: p.seam === true || SEAM_PATH.test(p.title || ""),
      mergedAt: pr?.state === "MERGED" ? pr.mergedAt : null,
      level: graph.cycle.includes(p.id) ? null : graph.levels.findIndex(ids => ids.includes(p.id)),
      source: { file: "docs/PLAN.md", line: p.line ?? null } };
  });
  const directions = [...new Set(packages.map(p => p.direction))].map(name => {
    const rows = packages.filter(p => p.direction === name), pending = rows.filter(p => !p.finished);
    const current = p => p.open && !p.parked;
    const next = p => !current(p) && !p.parked && !p.blocker && p.deps.every(id => packages.find(d => d.id === id)?.finished);
    return { name, now: pending.filter(current).map(p => p.id), next: pending.filter(next).map(p => p.id),
      later: pending.filter(p => !current(p) && !next(p)).map(p => p.id), forecast: forecast(rows, packages, time) };
  });
  const decisions = (model.decisions || []).filter(d => {
    if (typeof plan !== "string") return true;
    const heading = plan.split(/\r?\n/).slice(0, d.line).filter(l => /^#{1,4} /.test(l)).at(-1) || "";
    return !/historisch/i.test(heading);
  });
  const latest = releases.filter(r => !r.isDraft && !r.isPrerelease).map(r => version(r.tagName)).filter(Boolean).sort(compareVersions).at(-1);
  const nextVersion = packages.filter(p => !p.finished).map(p => version(p.version)).filter(v => v && (!latest || compareVersions(v, latest) > 0)).sort(compareVersions)[0] || UNKNOWN;
  const openPrs = prs.filter(pr => pr.state === "OPEN" && (/^(codex|claude|kimi|opencode|glm)\//i.test(pr.headRefName || "") || packages.some(p => p.pr === pr.number)));
  const unmappedErrors = openPrs.filter(pr => !packages.some(p => p.pr === pr.number) && observedState({}, pr, time) === "Fehler");
  const haengt = packages.filter(p => !p.finished && (p.blocker || p.state === "Braucht dich" || p.owner === "du")).sort((a, b) => Number(b.owner === "du") - Number(a.owner === "du") || Number(b.blocker) - Number(a.blocker)).map(p => ({ id: p.id, what: p.title, who: p.owner, change: UNKNOWN, when: UNKNOWN, where: `PLAN:${p.source.line ?? "?"}`, blocker: p.blocker }));
  haengt.push(...unmappedErrors.map(pr => ({ id: `PR-${pr.number}`, what: `#${pr.number}`, who: "Worker", change: UNKNOWN, when: UNKNOWN, where: `PR:${pr.number}`, blocker: true })));
  return { stand: { generatedAt: new Date(time).toISOString(), mainSha },
    head: { nextVersion, open: new Set(openPrs.map(pr => pr.number)).size,
      yourSteps: packages.filter(p => !p.finished && p.owner === "du").length + new Set(decisions.filter(d => d.status === "open").map(d => d.id)).size,
      blockers: packages.filter(p => p.blocker).length + unmappedErrors.length }, haengt, directions, packages };
}
