#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const allowPath = join(root, "scripts/ci/architecture-drift.allow");
const rules = {
  SQL_OUTSIDE_STORE: "sqlx queries belong in store.rs or store/",
  RAW_PROCESS_SPAWN: "processes must be launched through proc.rs",
  DIRECT_BEGIN_IMMEDIATE: "writers must use the shared store transaction helper",
  API_STORE_BLOCK_ON: "ApiBackend must not add synchronous store calls",
  ERROR_TEXT_CLASSIFIER: "transport errors need typed mappings",
  RAW_APP_LOG: "application logs must use logging.rs",
  RAW_TAURI_TRANSPORT: "Tauri transport belongs behind src/lib/ipc",
  RAW_EVENT_EMIT: "new event families need an owner and TypeScript wrapper",
  HQ_DIRECT_DB: "HQ must use the API rather than the SQLite database",
  HQ_RAW_AUTH_FETCH: "only the Node proxy may attach the API token",
  DIAGNOSIS_COMMANDS_MOVED: "diagnosis commands belong in diagnosis_cmds.rs",
  SETTINGS_COMMANDS_MOVED: "settings commands belong in settings_cmds.rs",
};

function files(dir = root) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", "target", "dist"].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...files(path));
    else found.push(path);
  }
  return found;
}

function testOnly(path) {
  return /(^|\/)(tests?|fixtures?)(\/|$)/.test(path) || /(?:^|[._-])test(?:s|util)?(?:[._-]|$)/.test(basename(path));
}

function matchingBraceEnd(source, open) {
  let depth = 0, string = false, rawEnd = "", lineComment = false, blockComment = 0, escaped = false;
  for (let i = open; i < source.length; i += 1) {
    const pair = source.slice(i, i + 2);
    if (lineComment) { if (source[i] === "\n") lineComment = false; else continue; }
    if (blockComment) {
      if (pair === "/*") { blockComment += 1; i += 1; }
      else if (pair === "*/") { blockComment -= 1; i += 1; }
      continue;
    }
    if (string) {
      if (rawEnd && source.startsWith(rawEnd, i)) { string = false; i += rawEnd.length - 1; rawEnd = ""; }
      else if (rawEnd) continue;
      else if (escaped) escaped = false;
      else if (source[i] === "\\") escaped = true;
      else if (source[i] === '"') string = false;
      continue;
    }
    if (pair === "//") { lineComment = true; i += 1; continue; }
    if (pair === "/*") { blockComment = 1; i += 1; continue; }
    const raw = source.slice(i).match(/^r(#+)?"/);
    if (raw) { string = true; rawEnd = `"${raw[1] ?? ""}`; i += raw[0].length - 1; continue; }
    if (source[i] === '"') { string = true; continue; }
    // Char literals ('"', '{', '\'', '\u{41}') must not open strings or count braces; lifetimes ('a) do not match.
    // 12 chars cover the longest literal, '\u{10FFFF}' (10); the slice only bounds the regex input, it never truncates a match.
    const char = source[i] === "'" && source.slice(i, i + 12).match(/^'(?:\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F_]+\}|[^])|[^\\'\n])'/u);
    if (char) { i += char[0].length - 1; continue; }
    if (source[i] === "{") depth += 1;
    if (source[i] === "}" && --depth === 0) return i + 1;
  }
  return source.length;
}

function stripRustTests(source) {
  const pattern = /#\s*\[\s*cfg\s*\(\s*test\s*\)\s*\]\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+\w+\s*\{/g;
  let match;
  while ((match = pattern.exec(source))) {
    const end = matchingBraceEnd(source, source.indexOf("{", match.index));
    source = `${source.slice(0, match.index)}${" ".repeat(end - match.index)}${source.slice(end)}`;
    pattern.lastIndex = match.index;
  }
  return source;
}

const normalize = (text) => text.replace(/\s+/g, "");
const lineAt = (source, index) => source.slice(source.lastIndexOf("\n", index) + 1, source.indexOf("\n", index) < 0 ? source.length : source.indexOf("\n", index));

function regexHits(source, regex, wholeMatch = false) {
  const hits = [];
  for (const match of source.matchAll(regex)) hits.push(normalize(wholeMatch ? match[0] : lineAt(source, match.index)));
  return hits;
}

function block(source, marker) {
  const start = source.search(marker);
  if (start < 0) return "";
  const open = source.indexOf("{", start);
  return source.slice(start, matchingBraceEnd(source, open));
}

function callHits(source, startPattern, required) {
  const hits = [];
  for (const match of source.matchAll(startPattern)) {
    const open = source.indexOf("(", match.index);
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === "(") depth += 1;
      if (source[i] === ")" && --depth === 0) {
        const call = source.slice(match.index, i + 1);
        if (!required || required.test(call)) hits.push(normalize(call));
        break;
      }
    }
  }
  return hits;
}

function scan() {
  const rows = [];
  const add = (rule, path, hits) => {
    const seen = new Map();
    for (const hit of hits) {
      const n = (seen.get(hit) ?? 0) + 1;
      seen.set(hit, n);
      rows.push(`${rule}\t${path}\t${hit}${n > 1 ? `\t#${n}` : ""}`);
    }
  };
  for (const file of files()) {
    const path = relative(root, file).replaceAll("\\", "/");
    if (path === "scripts/ci/architecture-drift.mjs" || testOnly(path)) continue;
    if (!/\.(?:rs|js|mjs|ts|tsx)$/.test(path)) continue;
    let source = readFileSync(file, "utf8");
    if (path.endsWith(".rs")) source = stripRustTests(source);
    const rust = path.startsWith("src-tauri/src/") && path.endsWith(".rs");
    const app = path.startsWith("src/") && /\.(?:ts|tsx)$/.test(path);

    if (rust && path !== "src-tauri/src/store.rs" && !path.startsWith("src-tauri/src/store/"))
      add("SQL_OUTSIDE_STORE", path, regexHits(source, /sqlx::(?:query|query_as|query_scalar)(?:!|::<[^>]+>)?\s*\(/g));
    if (rust && path !== "src-tauri/src/proc.rs")
      add("RAW_PROCESS_SPAWN", path, regexHits(source, /(?:std::process::)?Command::new\s*\(/g));
    if (rust) add("DIRECT_BEGIN_IMMEDIATE", path, regexHits(source, /begin_with\s*\(\s*"BEGIN IMMEDIATE"/g, true));
    if (path === "src-tauri/src/main.rs") {
      const backend = block(source, /impl\s+ControlBackend\s+for\s+ApiBackend/);
      add("API_STORE_BLOCK_ON", path, callHits(backend, /tauri::async_runtime::block_on\s*\(/g, /self\.store/));
      add("DIAGNOSIS_COMMANDS_MOVED", path, regexHits(source, /fn\s+(?:get_log_path|get_panic_notice|get_reason_catalog|export_diagnosis|reveal_log_path|get_stuck_after_minutes|set_stuck_after_minutes)\s*\(/g));
      // ApiBackend keeps same-named trait methods; only free Tauri command fns are banned.
      const withoutBackend = source.replace(block(source, /impl\s+ControlBackend\s+for\s+ApiBackend/), "");
      add("SETTINGS_COMMANDS_MOVED", path, regexHits(withoutBackend, /fn\s+(?:get_agent_env_isolation|set_agent_env_isolation|get_continuous_activation|enable_continuous_activation|get_digest_enabled|set_digest_enabled|get_routing_status|set_product_mode|set_profile_enabled|set_category_learning|get_learning_settings)\s*\(/g));
    }
    if (path === "src-tauri/src/api.rs" || path.startsWith("src-tauri/src/api/"))
      add("ERROR_TEXT_CLASSIFIER", path, regexHits(source, /err(?:or)?\.(?:contains|starts_with)\s*\(/g));
    if (rust && path !== "src-tauri/src/logging.rs" && !path.startsWith("src-tauri/src/bin/"))
      add("RAW_APP_LOG", path, regexHits(source, /(?:eprintln!|println!)\s*\(/g));
    if (app && path !== "src/lib/ipc.ts" && !path.startsWith("src/lib/ipc/"))
      add("RAW_TAURI_TRANSPORT", path, regexHits(source, /\b(?:invoke|listen)\s*\(/g));
    if ((rust || app) && path !== "src-tauri/src/pty.rs") {
      const eventSource = path === "src-tauri/src/main.rs"
        ? source.replace(block(source, /impl\s+StatusSink\s+for\s+EventSink/), "") : source;
      add("RAW_EVENT_EMIT", path, regexHits(eventSource, /\.emit\s*\(/g));
    }
    if (/^scripts\/hq.*\.(?:js|mjs)$/.test(path) || /^docs\/dev-hq\/.*\.js$/.test(path))
      add("HQ_DIRECT_DB", path, regexHits(source, /projecta\.db|sqlite3|better-sqlite|sqlx/gi));
    if ((path.startsWith("scripts/") || app) && /\.(?:js|mjs|ts|tsx)$/.test(path))
      add("HQ_RAW_AUTH_FETCH", path, callHits(source, /\bfetch\s*\(/g, /x-projecta-token/i));
  }
  return [...new Set(rows)].sort();
}

export function checkPatterns() {
  if (!existsSync(allowPath)) throw new Error(`missing allowlist: ${allowPath}`);
  const allowed = new Set(readFileSync(allowPath, "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")));
  const added = scan().filter((row) => !allowed.has(row));
  if (added.length) {
    console.error(`architecture drift: ${added.length} new occurrence(s)`);
    added.forEach((row) => console.error(row));
    process.exitCode = 1;
  } else console.log("architecture drift: no new occurrences");
}

const seamPaths = ["api.rs", "main.rs", "store.rs", "bin/pa.rs"].map(name => `src-tauri/src/${name}`);
const budgetPath = "scripts/ci/seam-budget.json";
// Physical lines include comments, tests and blanks; CRLF and LF count alike.
const lines = source => source === "" ? 0 : source.split("\n").length - Number(source.endsWith("\n"));

function parseBudget(source) {
  const value = JSON.parse(source);
  if (!value || value.schemaVersion !== 1 || Object.keys(value).length !== 2 ||
      !Array.isArray(value.seams) || value.seams.length !== seamPaths.length) {
    throw new Error("invalid schema: expected schemaVersion 1 and four seams");
  }
  const ceilings = new Map();
  for (const entry of value.seams) {
    if (!entry || Object.keys(entry).length !== 2 || !seamPaths.includes(entry.path) ||
        ceilings.has(entry.path) || !Number.isSafeInteger(entry.maxLines) || entry.maxLines < 0) {
      throw new Error("invalid, duplicate or missing seam path/ceiling");
    }
    ceilings.set(entry.path, entry.maxLines);
  }
  return ceilings;
}

export function checkSeamBudget(args = []) {
  try {
    if (args.length && (args.length !== 2 || args[0] !== "--base" || !args[1])) {
      throw new Error("expected check [--base REF]");
    }
    const git = (...argv) => execFileSync("git", argv, {
      cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    });
    // Commit hooks inspect the pending merge tree before HEAD includes its other parent.
    const parents = ["HEAD"];
    if (!args.length && existsSync(resolve(root, git("rev-parse", "--git-path", "MERGE_HEAD").trim()))) {
      parents.push("MERGE_HEAD");
    }
    const base = args.length
      ? git("rev-parse", "--verify", "--end-of-options", `${args[1]}^{commit}`).trim()
      : git("merge-base", "origin/main", ...parents).trim();
    git("merge-base", "--is-ancestor", base, args.length ? "HEAD" : "origin/main");
    const current = parseBudget(readFileSync(join(root, budgetPath), "utf8"));
    const tracked = git("ls-tree", "--name-only", base, "--", budgetPath).trim();
    const baseline = tracked ? parseBudget(git("show", `${base}:${budgetPath}`)) :
      new Map(seamPaths.map(path => [path, lines(git("show", `${base}:${path}`))]));
    for (const path of seamPaths) {
      const ceiling = current.get(path);
      if (ceiling > baseline.get(path)) throw new Error(`${path}: ceiling raised (${ceiling} > ${baseline.get(path)})`);
      const count = lines(readFileSync(join(root, path), "utf8"));
      if (count > ceiling) throw new Error(`${path}: ${count} lines exceeds ceiling ${ceiling}`);
      console.log(`seam budget: ${path}: ${count} <= ${ceiling}`);
    }
  } catch (error) {
    console.error(`seam budget: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, option, ...rest] = process.argv.slice(2);
  if (command === "explain" && option in rules) {
    console.log(`${option}: ${rules[option]}`);
  } else if (command === "snapshot" && option === "--stdout") {
    console.log(scan().join("\n"));
  } else if (command === "check") {
    checkSeamBudget(option === undefined ? [] : [option, ...rest]);
    checkPatterns();
  } else {
    console.error("usage: architecture-drift.mjs check [--base REF] | snapshot --stdout | explain RULE");
    process.exitCode = 2;
  }
}
