// Claude Code PreToolUse guard (TOOL-RG-1): blocks Bash/PowerShell commands that
// break hard AGENTS.md rules. Reads the hook JSON on stdin, exits 2 with a
// one-line reason on stderr to block, exits 0 otherwise (also on any error:
// the guard must never break the agent). Wired in .claude/settings.json.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const base = (word) => word.replace(/^.*[\\/]/, '').replace(/\.exe$/i, '');
const WRAPPERS = new Set(['env', 'command', 'sudo', 'exec', 'time', 'nice', 'nohup', 'builtin']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'pwsh', 'powershell']);
const NEEDS_ARG = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);

// Bodies of heredocs are free text (commit messages); drop them before scanning.
const stripHeredocs = (cmd) =>
  cmd.replace(/(<<-?[ \t]*(['"]?)([A-Za-z_]\w*)\2[^\n]*\n)[\s\S]*?(\n[ \t]*\3[ \t]*(?=\n|$|\)))/g, '$1$4');

// Splits into pipelines of segments of words. A word records whether it starts
// unquoted (`bare`), so prose inside quotes is never mistaken for a command.
function tokenize(command) {
  const segments = [];
  let words = [];
  let word = '';
  let inWord = false;
  let bare = true;
  let piped = false;
  const endWord = () => { if (inWord) words.push({ t: word, bare }); word = ''; inWord = false; bare = true; };
  const endSegment = (pipe) => { endWord(); if (words.length) segments.push({ words, piped }); words = []; piped = pipe; };
  const src = stripHeredocs(command);
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"') {
      if (!inWord) { inWord = true; bare = false; }
      for (i++; i < src.length && src[i] !== c; i++) {
        if (c === '"' && src[i] === '\\' && i + 1 < src.length) i++;
        word += src[i];
      }
    } else if (c === '\\' && /[\s'"]/.test(src[i + 1] ?? '')) {
      inWord = true; word += src[++i];
    } else if (/\s/.test(c)) {
      if (c === '\n') endSegment(false); else endWord();
    } else if (c === '|') {
      const or = src[i + 1] === '|';
      if (or || src[i + 1] === '&') i++;
      endSegment(!or);
    } else if (c === '&' && !(/[<>]/.test(src[i - 1] ?? '') || src[i + 1] === '>')) {
      if (src[i + 1] === '&') i++;
      endSegment(false);
    } else if (c === ';' || c === '(' || c === ')' || c === '`') {
      endSegment(false);
    } else {
      inWord = true; word += c;
    }
  }
  endSegment(false);
  return segments;
}

const block = (reason) => ({ blocked: true, reason });

function gitReason(rest) {
  const texts = rest.map((w) => w.t);
  // Skip global options (`-C dir`, `-c k=v`, `--git-dir x`) to reach the subcommand.
  let i = 0;
  while (i < texts.length && texts[i].startsWith('-')) i += NEEDS_ARG.has(texts[i]) ? 2 : 1;
  const sub = texts[i];
  const args = texts.slice(i + 1);
  if (['commit', 'push', 'merge'].includes(sub) && args.includes('--no-verify')) {
    return 'BLOCKED: --no-verify on git commit/push/merge skips the hooks; green means prepush (AGENTS.md rule 3).';
  }
  if (sub === 'stash' && !['list', 'show'].includes(args[0])) {
    return 'BLOCKED: git stash (except list/show) touches the stash shared by all worktrees; make a WIP commit instead (AGENTS.md "Ownership and proof", CLAUDE.md Worktrees).';
  }
  if (sub === 'push' && args.some((a) => /^--force/.test(a) || /^-[A-Za-z]*f[A-Za-z]*$/.test(a) || /^\+\S/.test(a))) {
    return 'BLOCKED: forced git push (--force, -f, --force-with-lease, +refspec) is forbidden; ask the orchestrator for a replacement PR (AGENTS.md rules 3 and 8).';
  }
  return null;
}

function segmentReason(words, depth) {
  const texts = words.map((w) => w.t);
  let at = 0;
  while (at < texts.length && (/^\w+=/.test(texts[at]) || WRAPPERS.has(texts[at]))) at++;
  const tool = texts[at] === undefined ? '' : base(texts[at]);
  if (tool === 'git') return gitReason(words.slice(at + 1));
  const flag = texts.findIndex((t, k) => k > at && /^-(c|command)$/i.test(t));
  if (SHELLS.has(tool.toLowerCase()) && flag > 0 && texts[flag + 1] !== undefined && depth < 3) {
    return reasonFor(texts[flag + 1], depth + 1);
  }
  return null;
}

function reasonFor(command, depth = 0) {
  const pipelines = [];
  const segments = tokenize(command);
  for (const seg of segments) {
    if (seg.piped && pipelines.length) pipelines.at(-1).push(seg); else pipelines.push([seg]);
  }
  for (const seg of segments) {
    const hit = seg.words.find((w) => w.bare && (/^CARGO_PROFILE_\w+=/.test(w.t) || /^\$env:CARGO_PROFILE_/i.test(w.t)));
    if (hit) return 'BLOCKED: CARGO_PROFILE_* variables invalidate the whole dependency cache; never set them (AGENTS.md "Build slots", CLAUDE.md Build-Slots).';
    const why = segmentReason(seg.words, depth);
    if (why) return why;
  }
  const captured = /\bPIPESTATUS\b|\bpipefail\b/.test(command);
  for (const pipe of pipelines) {
    const gates = pipe.findIndex((s) => s.words.some((w) => /(^|[\\/])gates\.sh$/.test(w.t)));
    const masked = gates >= 0 && pipe.slice(gates + 1).some((s) => ['tail', 'head'].includes(base(s.words[0].t)));
    if (masked && !captured) {
      return 'BLOCKED: gates.sh piped into tail/head masks its exit code; run it unpiped or add `; echo "rc=${PIPESTATUS[0]}"` (AGENTS.md rule 3, CLAUDE.md Gates).';
    }
  }
  return null;
}

export function check(command) {
  if (typeof command !== 'string' || !command.trim()) return { blocked: false, reason: null };
  try {
    const reason = reasonFor(command);
    return reason ? block(reason) : { blocked: false, reason: null };
  } catch {
    return { blocked: false, reason: null };
  }
}

function main() {
  let command;
  try { command = JSON.parse(readFileSync(0, 'utf8'))?.tool_input?.command; } catch { return 0; }
  const verdict = check(command);
  if (verdict.blocked) process.stderr.write(`${verdict.reason}\n`);
  return verdict.blocked ? 2 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();
