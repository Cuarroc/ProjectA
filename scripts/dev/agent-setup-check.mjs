#!/usr/bin/env node
// SETUP-02 — agent setup check: "is this machine ready for an agent to work on
// ProjectA?" Read-only. It never prints the content of a config file, only
// whether the file exists, and it never changes anything.
//
//   npm run dev:agent-check            # text
//   npm run dev:agent-check -- --json  # machine-readable
//
// Exit code 1 only when a mandatory check fails (node, git, gh, cargo,
// AGENTS.md + its import in CLAUDE.md, core.hooksPath, identical skill
// copies). Everything else — optional harnesses, reviewer models, gh login,
// build slots, config presence — is a warning: a docs-only machine may
// legitimately lack Kimi or a cargo build slot.
//
// Structure: collect() is the only function that touches the machine, through
// injected probes; evaluate() is pure. The test drives both with a fake
// environment (scripts/lib/agent-setup-check.test.mjs), so it needs neither
// the binaries nor the network. Setup documentation: docs/setup/README.md.
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REVIEWER_MODELS = ["kimi-k3:cloud", "glm-5.2:cloud"];
export const BUILD_SLOTS = ["projecta-a", "projecta-b", "projecta-c"];
const SKILL_AGENTS = ".agents/skills/projecta-workflow/SKILL.md";
const SKILL_CLAUDE = ".claude/skills/projecta-workflow/SKILL.md";

// Fixed allow list: the only programs collect() may start, each with fixed
// arguments. `--version` output is local; `gh auth status` and `ollama list`
// talk to the local keyring / local Ollama daemon.
export const OPTIONAL_BINARIES = {
  "cargo-nextest": { args: ["nextest", "--version"], cmd: "cargo", why: "rust-suite gate (cargo nextest run --profile ci)", fix: "cargo install cargo-nextest --locked" },
  python: { args: ["--version"], why: ".pa/review_transport.py (Ollama reviews)", fix: "Install Python 3 and make `python` resolve on PATH." },
  claude: { args: ["--version"], why: "Claude Code harness", fix: "See docs/setup/claude-code.md." },
  codex: { args: ["--version"], why: "Codex CLI harness / GPT-6 Astra advisor", fix: "See docs/setup/codex.md." },
  opencode: { args: ["--version"], why: "OpenCode harness", fix: "See docs/setup/opencode.md." },
  kimi: { args: ["--version"], why: "Kimi Code CLI harness", fix: "See docs/setup/kimi.md." },
  ollama: { args: ["--version"], why: "reviewer pair via Ollama Cloud", fix: "See docs/setup/ollama-reviewers.md." },
};
export const REQUIRED_BINARIES = {
  git: { args: ["--version"], fix: "Install git." },
  gh: { args: ["--version"], fix: "Install the GitHub CLI (https://cli.github.com); PRs are opened with gh." },
  cargo: { args: ["--version"], fix: "Install rustup (https://rustup.rs); every gate lane runs cargo." },
};

const CONFIGS = {
  claudeSettings: "~/.claude/settings.json",
  codexConfig: "~/.codex/config.toml",
  opencodeConfig: "~/.config/opencode/opencode.jsonc",
  kimiConfig: "~/.kimi-code/config.toml",
  kimiCredentials: "~/.kimi-code/credentials/",
};

const ok = (detail) => ({ state: "ok", detail, fix: null });
const warn = (detail, fix) => ({ state: "warn", detail, fix });
const fail = (detail, fix) => ({ state: "fail", detail, fix });
const normalize = (text) => String(text).replace(/\r\n/g, "\n");

// `@AGENTS.md` imports only as a line of its own (Claude Code import syntax);
// inside backticks or prose it is text, not an import.
export function hasAgentsImport(claudeMd) {
  if (typeof claudeMd !== "string") return false;
  return normalize(claudeMd).split("\n").some((line) => line.trim() === "@AGENTS.md");
}

function binaryCheck(name, spec, required) {
  return {
    id: `bin-${name}`,
    label: `${name} on PATH`,
    required,
    run: (p) => {
      const version = p.binaries?.[name];
      if (version) return ok(version);
      return required ? fail(`${name} not found`, spec.fix) : warn(`${name} not found — needed for ${spec.why}`, spec.fix);
    },
  };
}

export const CHECKS = [
  {
    id: "node",
    label: "Node.js >= 24",
    required: true,
    run: (p) => {
      const major = Number(String(p.nodeVersion || "").replace(/^v/, "").split(".")[0]);
      return major >= 24 ? ok(`node ${p.nodeVersion}`) : fail(`node ${p.nodeVersion || "missing"}`, "Install Node.js 24 or newer, then npm ci.");
    },
  },
  ...Object.entries(REQUIRED_BINARIES).map(([name, spec]) => binaryCheck(name, spec, true)),
  ...Object.entries(OPTIONAL_BINARIES).map(([name, spec]) => binaryCheck(name, spec, false)),
  {
    id: "agents-md",
    label: "AGENTS.md at the repository root",
    required: true,
    run: (p) => (p.agentsMd ? ok("AGENTS.md present") : fail("AGENTS.md missing", "Run from the repository root of a ProjectA checkout.")),
  },
  {
    id: "claude-md-import",
    label: "CLAUDE.md imports AGENTS.md",
    required: true,
    run: (p) =>
      hasAgentsImport(p.claudeMd)
        ? ok("@AGENTS.md import line present")
        : fail(p.claudeMd == null ? "CLAUDE.md missing" : "no `@AGENTS.md` line in CLAUDE.md", "Add a line containing only @AGENTS.md to CLAUDE.md (by convention the first line); Claude Code does not read AGENTS.md on its own."),
  },
  {
    id: "hooks-path",
    label: "git core.hooksPath points at .githooks",
    required: true,
    run: (p) => {
      const value = String(p.hooksPath || "").trim().replace(/[\\/]+$/, "");
      return /(^|[\\/])\.githooks$/.test(value)
        ? ok(`core.hooksPath=${value}`)
        : fail(`core.hooksPath=${value || "(unset)"}`, "npm run dev:setup  (or: git config core.hooksPath .githooks)");
    },
  },
  {
    id: "skill-copies",
    label: "projecta-workflow skill: both copies identical",
    required: true,
    run: (p) => {
      if (p.skillAgents == null || p.skillClaude == null) {
        const missing = [p.skillAgents == null && SKILL_AGENTS, p.skillClaude == null && SKILL_CLAUDE].filter(Boolean).join(", ");
        return fail(`missing: ${missing}`, `Restore the file from git; ${SKILL_AGENTS} and ${SKILL_CLAUDE} must both exist.`);
      }
      return normalize(p.skillAgents) === normalize(p.skillClaude)
        ? ok(`${SKILL_AGENTS} == ${SKILL_CLAUDE}`)
        : fail(`${SKILL_AGENTS} and ${SKILL_CLAUDE} differ`, `Edit ${SKILL_AGENTS}, then copy it over ${SKILL_CLAUDE} (byte-identical apart from line endings).`);
    },
  },
  {
    id: "gh-auth",
    label: "gh is logged in",
    required: false,
    run: (p) => (p.ghAuth ? ok("gh auth status: logged in") : warn("gh auth status: not logged in (or gh missing)", "gh auth login")),
  },
  {
    id: "reviewer-models",
    label: "Ollama reviewer pair available",
    required: false,
    run: (p) => {
      const have = new Set(p.ollamaModels || []);
      const missing = REVIEWER_MODELS.filter((m) => !have.has(m));
      if (missing.length === 0) return ok(REVIEWER_MODELS.join(" + "));
      const pull = `ollama signin; ${missing.map((m) => `ollama pull ${m}`).join("; ")}`;
      return warn(
        `missing: ${missing.join(", ")}`,
        p.binaries?.ollama ? pull : `Install Ollama first (see bin-ollama, docs/setup/ollama-reviewers.md), then: ${pull}`,
      );
    },
  },
  {
    id: "build-slots",
    label: "cargo build slots (Windows)",
    required: false,
    run: (p) => {
      if (p.platform !== "win32") return ok("not used on this platform");
      const missing = BUILD_SLOTS.filter((s) => !p.slots?.[s]);
      if (missing.length === 0) return ok(`${BUILD_SLOTS.join(", ")} under ${p.slotRoot}`);
      return warn(`missing under ${p.slotRoot}: ${missing.join(", ")}`, "Build slots are warm copies of target/ (docs/setup/claude-code.md); without them set CARGO_TARGET_DIR yourself. Never set CARGO_PROFILE_*.");
    },
  },
  {
    id: "configs",
    label: "harness config files present (names only)",
    required: false,
    run: (p) => {
      const missing = Object.entries(CONFIGS).filter(([key]) => !p.configs?.[key]).map(([, path]) => path);
      if (missing.length === 0) return ok(Object.values(CONFIGS).join(", "));
      return warn(`not found: ${missing.join(", ")}`, "Only needed for the harnesses you run; see docs/setup/.");
    },
  },
];

export function evaluate(probe) {
  const checks = CHECKS.map((check) => {
    let outcome;
    try {
      outcome = check.run(probe);
    } catch (error) {
      outcome = { state: check.required ? "fail" : "warn", detail: `check crashed: ${error.message}`, fix: null };
    }
    return { id: check.id, label: check.label, required: check.required, ...outcome };
  });
  const counts = { ok: 0, warn: 0, fail: 0 };
  for (const c of checks) counts[c.state] += 1;
  return { ok: counts.fail === 0, counts, checks };
}

export function exitCode(result) {
  return result.ok ? 0 : 1;
}

export function formatText(result) {
  const lines = ["agent-setup-check (docs/setup/README.md)", ""];
  for (const c of result.checks) {
    lines.push(`[${c.state}] ${c.id}${c.required ? " (mandatory)" : ""}: ${c.detail}`);
    if (c.fix && c.state !== "ok") lines.push(`       fix: ${c.fix}`);
  }
  lines.push("", `ok ${result.counts.ok} · warn ${result.counts.warn} · fail ${result.counts.fail} — ${result.ok ? "ready" : "NOT ready (mandatory check failed)"}`);
  return lines.join("\n") + "\n";
}

// `ollama list` prints a header row starting with NAME, then one model per
// line. Anything before the header (update notices, warnings) is skipped; the
// header itself is never a model.
export function parseOllamaList(stdout) {
  const lines = String(stdout || "").split(/\r?\n/).map((l) => l.trim());
  const header = lines.findIndex((l) => /^NAME\s/.test(l));
  if (header === -1) return [];
  return lines
    .slice(header + 1)
    .map((l) => l.split(/\s+/)[0])
    .filter(Boolean);
}

function firstLine(text) {
  return String(text || "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) || null;
}

// The only place that touches the machine. Every dependency is injectable.
export function collect({
  root = process.cwd(),
  home = homedir(),
  env = process.env,
  platform = process.platform,
  nodeVersion = process.version,
  exists = existsSync,
  readFile = (p) => readFileSync(p, "utf8"),
  run = defaultRun(platform),
} = {}) {
  const readOrNull = (p) => {
    try {
      return readFile(p);
    } catch {
      return null;
    }
  };
  const version = (cmd, args) => {
    const res = run(cmd, args);
    return res && res.status === 0 ? firstLine(res.stdout) || firstLine(res.stderr) : null;
  };

  const binaries = {};
  for (const [name, spec] of Object.entries({ ...REQUIRED_BINARIES, ...OPTIONAL_BINARIES })) {
    binaries[name] = version(spec.cmd || name, spec.args);
  }

  const hooks = run("git", ["config", "--get", "core.hooksPath"]);
  // Asked directly, not gated on `--version`: a missing binary simply fails.
  const gh = run("gh", ["auth", "status"]);
  const ollama = run("ollama", ["list"]);
  const ollamaModels = ollama && ollama.status === 0 ? parseOllamaList(ollama.stdout) : [];

  const at = (rel) => join(root, ...rel.split("/"));
  const inHome = (tilde) => join(home, ...tilde.replace(/^~\//, "").split("/").filter(Boolean));
  const configs = {};
  for (const [key, path] of Object.entries(CONFIGS)) configs[key] = Boolean(exists(inHome(path)));

  const slotRoot = env.PROJECTA_BUILD_SLOTS_ROOT || join(home, "cargo-targets");
  const slots = {};
  for (const s of BUILD_SLOTS) slots[s] = Boolean(exists(join(slotRoot, s)));

  return {
    platform,
    nodeVersion,
    binaries,
    agentsMd: Boolean(exists(at("AGENTS.md"))),
    claudeMd: readOrNull(at("CLAUDE.md")),
    hooksPath: hooks && hooks.status === 0 ? firstLine(hooks.stdout) : null,
    skillAgents: readOrNull(at(SKILL_AGENTS)),
    skillClaude: readOrNull(at(SKILL_CLAUDE)),
    configs,
    ollamaModels,
    ghAuth: Boolean(gh && gh.status === 0),
    slotRoot,
    slots,
  };
}

function defaultRun(platform) {
  const options = { encoding: "utf8", timeout: 15000, windowsHide: true };
  // npm-installed CLIs (codex, opencode) are .cmd shims on Windows, which
  // spawnSync only starts through a shell. cmd and args are fixed literals
  // from the tables above, never user input, so one joined command line is safe.
  if (platform === "win32") return (cmd, args) => spawnSync([cmd, ...args].join(" "), { ...options, shell: true });
  return (cmd, args) => spawnSync(cmd, args, options);
}

export function main(argv = process.argv.slice(2), { probe = () => collect({ root: repoRoot() }), write = (s) => process.stdout.write(s) } = {}) {
  const result = evaluate(probe());
  write(argv.includes("--json") ? JSON.stringify(result, null, 2) + "\n" : formatText(result));
  return exitCode(result);
}

function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
