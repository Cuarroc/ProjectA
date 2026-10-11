import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { isMain, makeRunner, runCli, withExitCodes } from "../lib/dev-tools.mjs";

export const APPROVAL_WORDS = Object.freeze([
  "Geld", "Kosten", "kaufen", "bezahlen", "löschen", "delete", "Release", "Tag veröffentlichen",
  "installieren", "install", "Secret", "Schlüssel", "Token", "Passwort", "Rechte ändern", "Berechtigung ändern",
]);
const OPERATORS = "PRÜFEN|BELEGEN|MESSEN|RECHERCHIEREN|ERFRAGEN|ENTWERFEN|VORSCHLAGEN|ENTSCHEIDEN|UMSETZEN|NACHBESSERN|REVIEWEN|INTEGRIEREN|PFLEGEN|BERICHTEN|ÜBERGEBEN|BLOCKIERT MELDEN".split("|");
const SHA = /\b[\da-f]{7,40}\b/i;
const TRAILER = /^\s*(Test-First|Regression-For|No-Test):\s*(.*)$/;
const decision = (reasons, approvals = []) => ({ exit: approvals.length ? 3 : reasons.length ? 2 : 0, reasons, approvals });

// Keep line numbers stable while removing fenced examples from structural checks.
function proseLines(text) {
  let fence;
  return text.split(/\r?\n/).map((line) => {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.replace(/^(?:\s*>\s?)+/, ""));
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !m[2].trim()) fence = undefined;
      return "";
    }
    if (m) { fence = m[1]; return ""; }
    return line;
  });
}

export function parseBrief(text) {
  const fields = {};
  let current;
  for (const line of proseLines(text)) {
    const m = /^\s*([A-Z][A-Z/-]*)(?:[ \t]+\([^)]*\))?:[ \t]*(.*)$/.exec(line);
    if (m) {
      current = m[1] === "TIER/REVIEW" ? "TIER" : m[1];
      fields[current] = fields[current] === undefined ? m[2].trim() : "";
    } else if (current && /^(?:\s+\S|[-*] )/.test(line) && !TRAILER.test(line)) {
      fields[current] += `\n${line.trim()}`;
    } else current = undefined;
  }
  return fields;
}

// Pure rule evaluation: repo evidence is supplied by the CLI, never read here.
export function lint(text, { prBody = false, baseExists = true } = {}) {
  const lines = proseLines(text);
  const reasons = [], approvals = [];
  lines.forEach((line, i) => {
    if (/^\s*NON-GOALS(?:\s+\([^)]*\))?:/i.test(line) || /^(?: {4}|\t)/.test(line)) return;
    for (const word of APPROVAL_WORDS) {
      const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${word.replaceAll(" ", "[ \\t]+")}(?![\\p{L}\\p{N}_])`, "giu");
      for (const match of line.matchAll(pattern)) approvals.push({ word: match[0], line: i + 1 });
    }
  });
  if (prBody) {
    if (!lines.some((l) => /^## Report\s*$/.test(l))) reasons.push("## Report fehlt");
    if (!lines.some((l) => /\bNICHT ABGEDECKT\b/.test(l))) reasons.push("NICHT ABGEDECKT fehlt");
    text.split(/\r?\n/).forEach((line, i) => {
      if (TRAILER.test(line)) reasons.push(`Zeile ${i + 1}: Commit-Trailer im PR-Text`);
    });
    let reviewSection = false;
    if (lines.some((l) => {
      if (/^#+\s/.test(l)) reviewSection = /\breview\b/i.test(l);
      return (reviewSection || /\breview\b/i.test(l)) && /\bausstehend\b/i.test(l);
    })) reasons.push("Review fehlt");
  } else {
    const f = parseBrief(text);
    for (const key of ["OPERATOR", "GOAL", "NON-GOALS", "BASE", "FILES", "SEAM", "ACCEPTANCE", "TIER", "RETURN"]) {
      if (!f[key]?.trim()) reasons.push(`${key} fehlt oder ist leer`);
    }
    if (f.OPERATOR && !OPERATORS.includes(f.OPERATOR)) reasons.push("OPERATOR unbekannt");
    if (f.BASE && !SHA.test(f.BASE)) reasons.push("BASE enthält keinen 7–40-stelligen Hex-SHA");
    if (!baseExists) reasons.push("BASE-SHA ist im Repo kein auflösbarer Commit");
    if (f.FILES && !/(?:[\w.-]+[/\\])+[\w.*-]*|\b[\w-]+\.[\w.-]+\b/.test(f.FILES)) reasons.push("FILES enthält keinen Pfad");
    if (/\b(?:(?:api\.rs|main\.rs|store\.rs|bin[/\\]pa\.rs)\b|store[/\\])/.test(f.FILES ?? "") && /^no\b/i.test(f.SEAM ?? "")) {
      reasons.push("Naht in FILES, aber SEAM: no");
    }
    if (["UMSETZEN", "NACHBESSERN"].includes(f.OPERATOR)) {
      const numbers = f.SIZE?.match(/-?\d+(?:[.,]\d+)?/g) ?? [];
      if (numbers.length !== 1 || !/^\d+$/.test(numbers[0]) || Number(numbers[0]) > 300) reasons.push("SIZE braucht eine ganze Zahl ≤ 300");
      const trailers = lines.map((l) => TRAILER.exec(l)).filter(Boolean);
      if (!trailers.some((m) => m[2].trim())) reasons.push("Test-First/Regression-For/No-Test fehlt oder ist leer");
      for (const m of trailers) {
        if (m[1] === "Test-First" && !/^[^\s:]+::\S.*$/.test(m[2])) reasons.push("Test-First braucht <pfad>::<name>");
      }
    }
  }
  return decision(reasons, approvals);
}

const HELP = `brief-lint — rein regelbasierte Prüfung, nur lesend
  node scripts/dev/brief-lint.mjs <file> [--repo <dir>] [--json]
  node scripts/dev/brief-lint.mjs --pr-body <file> [--json]
Exit 0: startbar/annehmbar; 2: Root/LLM nötig; 3: Entscheidung nötig (Vorrang).
Prüft Pflichtfelder, Operator, SHA, Pfade, Naht, Größe, Trailer und PR-Struktur.
Freigabewörter außerhalb NON-GOALS-Zeilen und Codeblöcken brauchen Entscheidung.
`;
export const main = withExitCodes(async (argv, io, { run = makeRunner() } = {}) => {
  let result;
  try {
    const { values: v, positionals: p } = parseArgs({ args: argv, allowPositionals: true, options: {
      help: { type: "boolean", short: "h" }, json: { type: "boolean" }, repo: { type: "string" }, "pr-body": { type: "string" },
    } });
    if (v.help) { io.out(HELP); return 0; }
    if (v["pr-body"] !== undefined ? p.length || v.repo !== undefined || !v["pr-body"] : p.length !== 1) {
      result = decision(["Genau eine Brief-Datei oder --pr-body <file> angeben; --repo nur für Briefe"]);
    } else {
      const text = readFileSync(v["pr-body"] ?? p[0], "utf8");
      const sha = parseBrief(text).BASE?.match(SHA)?.[0];
      const baseExists = v.repo === undefined || !sha || run("git", ["-C", v.repo, "cat-file", "-e", `${sha}^{commit}`]).code === 0;
      result = lint(text, { prBody: v["pr-body"] !== undefined, baseExists });
    }
  } catch (e) { result = decision([`Aufruf/Eingabe nicht prüfbar: ${e.code ?? "Fehler"}`]); }
  io.out(argv.includes("--json") ? `${JSON.stringify(result)}\n` : [
    ...result.reasons, ...result.approvals.map((a) => `Zeile ${a.line}: Freigabewort „${a.word}“`),
    `brief-lint: ${result.exit === 0 ? "startbar/annehmbar" : result.exit === 2 ? "Root/LLM nötig" : "Elias-Entscheidung nötig"} (Exit ${result.exit})`,
  ].join("\n") + "\n");
  return result.exit;
});
if (isMain(import.meta.url)) runCli(main);
