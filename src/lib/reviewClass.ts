/**
 * Review class of a changed path, from AGENTS.md rule 5 ("Reviews by risk").
 * This is the ONE place the path list lives in the frontend; if AGENTS.md
 * changes the tiers, change them here and nowhere else.
 *
 *   A  seam (`api.rs`, `main.rs`, `store.rs`, `store/`, `bin/pa.rs`), PTY,
 *      migrations / databases, concurrency, security / credential code
 *   C  only documentation, tests, snapshots
 *   B  other Rust/TS code
 *   unknown  no rule matches with certainty; treat like A
 *
 * This is a review class, not a safety rating: no class means "harmless".
 */
export type ReviewClass = "A" | "B" | "C" | "unknown";

const CODE_DIRS = ["src/", "src-tauri/", "scripts/", ".github/", ".claude/", ".githooks/"];

const SEAM_FILES = [
  "src-tauri/src/api.rs",
  "src-tauri/src/main.rs",
  "src-tauri/src/store.rs",
  "src-tauri/src/pty.rs",
  "src-tauri/src/bin/pa.rs",
];
const A_PREFIXES = ["src-tauri/src/store/", "src-tauri/src/pty/", "src-tauri/src/process_capture/", "src-tauri/capabilities/"];
// Whole name tokens of the file stem, joined with `_` (see `nameTokens`); an entry with
// `_` is a token sequence. `clock`, `blockingQueue` and `deadlock` do not contain the
// token `lock`, so they stay B.
const A_NAMES = [
  "capability",
  "capabilities",
  "credential",
  "credentials",
  "agent_access",
  "security",
  "secret",
  "secrets",
  "redact",
  "redacted",
  "redaction",
  "redactor",
  "setupgate",
  "setup_gate",
  "estop",
  "emergency_stop",
  "db_restore",
  "supervisor",
  "concurrency",
  "concurrent",
  "mutex",
  "lock",
  "locks",
];
const A_DIR = /(^|\/)migrations\//;

const TEST_NAME = /(\.test\.[jt]sx?|_tests?\.rs|\.snap)$/;
const TEST_DIR = /(^|\/)(tests|__snapshots__|snapshots)\//;

const RANK: Record<ReviewClass, number> = { C: 0, B: 1, unknown: 2, A: 3 };

/** Lower-case tokens of a file stem, split on `.`, `_`, `-` and camelCase boundaries, joined by `_`. */
function nameTokens(fileName: string): string {
  const stem = fileName.replace(/\.[^.]*$/, "");
  const spaced = stem.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return spaced
    .split(/[^A-Za-z0-9]+/)
    .filter((token) => token !== "")
    .join("_")
    .toLowerCase();
}

function hasAName(fileName: string): boolean {
  const tokens = `_${nameTokens(fileName)}_`;
  return A_NAMES.some((name) => tokens.includes(`_${name}_`));
}

export function classifyPath(rawPath: string): ReviewClass {
  const path = rawPath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (TEST_NAME.test(path) || TEST_DIR.test(path)) return "C";
  if (
    SEAM_FILES.includes(path) ||
    A_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
    A_DIR.test(path) ||
    (/\.(rs|ts|tsx|sql)$/.test(path) && hasAName(path.slice(path.lastIndexOf("/") + 1)))
  ) {
    return "A";
  }
  if (path.endsWith(".md")) {
    return CODE_DIRS.some((dir) => path.startsWith(dir)) ? "unknown" : "C";
  }
  if (/^src-tauri\/src\/.+\.rs$/.test(path) || /^src\/.+\.(ts|tsx)$/.test(path)) return "B";
  return "unknown";
}

/** The overall class of a diff is its highest single class; `unknown` ranks just below A. */
export function classifyDiff(paths: readonly string[]): ReviewClass | null {
  let result: ReviewClass | null = null;
  for (const path of paths) {
    const cls = classifyPath(path);
    if (result === null || RANK[cls] > RANK[result]) result = cls;
  }
  return result;
}

export interface ReviewClassInfo {
  /** Short badge text. */
  label: string;
  /** One plain-German sentence for the person looking at the diff. */
  explanation: string;
}

const INFO: Record<ReviewClass, ReviewClassInfo> = {
  A: {
    label: "A",
    explanation: "braucht zwei Prüfer anderer Anbieter (Nahtstelle, Sicherheit, PTY oder Datenbank).",
  },
  B: { label: "B", explanation: "braucht einen Prüfer aus einer anderen Modellfamilie (übriger Rust-/TypeScript-Code)." },
  C: {
    label: "C",
    explanation: "braucht keinen externen Prüfer; die automatischen Prüfungen genügen (nur Doku oder Tests).",
  },
  unknown: {
    label: "?",
    explanation: "unbekannt – im Zweifel wie A behandeln (keine Regel greift eindeutig).",
  },
};

export function reviewClassInfo(cls: ReviewClass): ReviewClassInfo {
  return INFO[cls];
}
