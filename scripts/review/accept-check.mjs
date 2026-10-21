import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { lint, sizeLimit, tierFor } from "../dev/brief-lint.mjs";
import { isMain, makeRunner, runCli } from "../lib/dev-tools.mjs";
export { tierFor } from "../dev/brief-lint.mjs";

const FIELDS = "headRefOid,isDraft,additions,deletions,files,body,statusCheckRollup,labels";
const count = n => Number.isSafeInteger(n) && n >= 0;
export function familyFor(model) {
  return /^(glm|kimi|claude|gpt|gemini|deepseek)(?:[-_.]|$)/i.exec(model)?.[1].toLowerCase();
}
export function parseReview(text) {
  if (/^\s*(?:`{3}|~{3})/m.test(text)) return false;
  const lines = text.replaceAll("\r", "").split("\n");
  const statuses = lines.filter(l => /^- Status:/.test(l));
  const headings = lines.flatMap((l, i) => /^#{1,6} Correctness(?: \/ spec)?\s*$/i.test(l) ? [i] : []);
  const start = headings[0];
  let end = start + 1;
  while (end < lines.length && !/^#{1,6} |^(?:\*\*)?Verdict:/i.test(lines[end])) end++;
  const correctness = lines.slice(start + 1, end).join("\n").trim();
  const verdicts = text.match(/^(?:\*\*)?Verdict:(?:\*\*)?\s*(.+)$/gim) ?? [];
  const sectionVerdicts = text.match(/^#{1,6} Verdict\s*\r?\n\s*([^\r\n]+)/gim) ?? [];
  const bareVerdict = !verdicts.length && !sectionVerdicts.length && /^approve\s*$/i.test(lines.at(-1)?.trim() || lines.at(-2)?.trim()) ? ["Verdict: approve"] : [];
  const verdict = [...verdicts, ...sectionVerdicts, ...bareVerdict];
  return statuses.length === 1 && statuses[0].trim() === "- Status: ok" && headings.length === 1 &&
    /^none$/i.test(correctness) && verdict.length === 1 &&
    /^(?:\*\*)?Verdict:(?:\*\*)?\s*approve\s*$|^#{1,6} Verdict\s*\r?\n\s*approve\s*$/i.test(verdict[0]);
}
function result(reasons, approvals = [], detail = "") {
  const exit = approvals.length ? 3 : reasons.length ? 2 : 0;
  return { exit, reasons, output: [exit === 0 ? "AUTO-OK" : exit === 3 ? "Nutzer-Entscheidung" : "ESCALATE",
    ...reasons, ...approvals.map(a => `Zeile ${a.line}: Freigabewort „${a.word}“`), ...(exit === 0 ? [detail] : [])].join("\n") + "\n" };
}
// Pure decision over GitHub data and review file contents; never writes or calls a model.
export function assess(pr, reviews, number) {
  const body = typeof pr?.body === "string" ? lint(pr.body, { prBody: true }) : { reasons: ["PR-Text fehlt"], approvals: [] };
  const reasons = [...body.reasons];
  if (!pr || !/^[a-f0-9]{40}$/i.test(pr.headRefOid) || typeof pr.isDraft !== "boolean" ||
      !count(pr.additions) || !count(pr.deletions) || !Array.isArray(pr.files) || !pr.files.length ||
      !pr.files.every(f => f && typeof f.path === "string" && f.path && count(f.additions) && count(f.deletions)) ||
      !Array.isArray(pr.labels) || !pr.labels.every(l => typeof l?.name === "string") || !Array.isArray(pr.statusCheckRollup)) {
    return result([...reasons, "PR-Daten fehlen oder sind ungültig"], body.approvals);
  }
  const total = pr.files.reduce((n, f) => n + f.additions + f.deletions, 0);
  if (total !== pr.additions + pr.deletions) reasons.push("Dateiliste und PR-Größe stimmen nicht überein");
  const tier = tierFor(pr.files.map(f => f.path));
  // Like review-ok, these shared-account label signals authenticate nothing.
  // Only Root/Chief sets them, with a prior ticket/msg or forcing finding IDs in a
  // PR comment. Root acceptance verifies native decision-before-dispatch evidence
  // and records it in the report; this check is conventional, not cryptographic.
  const signals = pr.labels.filter(l => /size[\s_-]*(budget|fix)/i.test(l.name));
  const budgets = signals.filter(l => /^size-budget-[1-9]\d{0,2}$/.test(l.name) && !/\s/.test(l.name) &&
    Number(l.name.slice("size-budget-".length)) <= 600);
  const fixes = signals.filter(l => l.name === "size-fix-round");
  const conflict = signals.length !== budgets.length + fixes.length || budgets.length > 1 || fixes.length > 1;
  const limit = conflict ? 300 : sizeLimit(tier, Number(budgets[0]?.name.slice("size-budget-".length)), fixes.length === 1);
  // No identity/manifest evidence is supplied: even pure lock/move/generated claims
  // count in full. In particular these gh fields cannot prove a Dependabot exception.
  if (total > limit) reasons.push(`Größe ${total} > ${limit}`);
  if (pr.isDraft) reasons.push("PR ist Draft");
  for (const { name } of pr.labels) if (["do-not-merge", "conflict"].includes(name)) reasons.push(`Label: ${name}`);
  for (const check of pr.statusCheckRollup) {
    const state = check?.conclusion || check?.state || check?.status;
    if (!["SUCCESS", "NEUTRAL", "SKIPPED"].includes(state)) reasons.push(`Check: ${state ?? "unbekannt"}`);
  }
  const sha = pr.headRefOid.slice(0, 8);
  const families = new Set(), reviewers = [];
  for (const review of reviews) {
    const match = /^review_pr(\d+)-([a-f0-9]{8})_([\w.-]+)\.md$/i.exec(review.name);
    if (!match || match[1] !== String(number)) continue;
    if (match[2] !== sha) { reasons.push(`Review veraltet: ${review.name}`); continue; }
    const family = familyFor(match[3]);
    const reported = /^- Reviewer: ([\w.-]+) \(kind \w+\)\s*$/m.exec(review.text)?.[1];
    if (!family || reported !== match[3] || !parseReview(review.text)) { reasons.push(`Review nicht eindeutig freigegeben: ${review.name}`); continue; }
    families.add(family); reviewers.push(match[3]);
  }
  const needed = { A: 2, B: 1, C: 0 }[tier];
  if (families.size < needed) reasons.push(`Tier ${tier}: ${needed} Review-Familie(n) benötigt, ${families.size} vorhanden`);
  const decision = result(reasons, body.approvals, `### Review (accept-check, bound to head \`${sha}\`)\n- Reviewer: ${reviewers.join(", ") || "none required"}\n- Verdict: approve\n- Tier: ${tier}`);
  decision.output += `- Größe: ${total} lines (raw diff: ${total}; ceiling: ${limit})\n`;
  return decision;
}
// Minimal top-level metadata scan; JSON.parse remains the grammar validator.
// Whole string tokens keep body examples/nested metadata from masquerading as keys.
function duplicateLabels(raw) {
  let depth = 0, labels = 0;
  for (const token of raw.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]]/g)) {
    const text = token[0];
    if (text.startsWith('"')) {
      if (depth === 1 && /^\s*:/.test(raw.slice(token.index + text.length)) && JSON.parse(text) === "labels" && ++labels > 1) return true;
    } else depth += text === "{" || text === "[" ? 1 : -1;
  }
  return false;
}
export async function main(argv, io, { run = makeRunner({ timeoutMs: 30_000 }) } = {}) {
  let decision;
  try {
    const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { reviews: { type: "string" } } });
    if (positionals.length !== 1 || !/^[1-9]\d*$/.test(positionals[0]) || !values.reviews) throw new Error("usage");
    const response = run("gh", ["pr", "view", positionals[0], "--json", FIELDS]);
    if (response.code !== 0) throw new Error("github");
    const reviews = readdirSync(values.reviews).filter(name => name.startsWith(`review_pr${positionals[0]}-`) && name.endsWith(".md"))
      .sort().map(name => ({ name, text: readFileSync(join(values.reviews, name), "utf8") }));
    const data = JSON.parse(response.stdout);
    if (duplicateLabels(response.stdout)) {
      const body = typeof data?.body === "string" ? lint(data.body, { prBody: true }) : { approvals: [] };
      decision = result(["Doppeltes labels-Feld in PR-JSON"], body.approvals);
    } else decision = assess(data, reviews, positionals[0]);
  } catch { decision = result(["Aufruf oder Eingaben nicht prüfbar; erwartet: <pr> --reviews <dir>"]); }
  io.out(decision.output);
  return decision.exit;
}
if (isMain(import.meta.url)) runCli(main);
