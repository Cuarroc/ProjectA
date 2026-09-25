// Setup helper for the Dev HQ: every check is a pure function over injected
// probes so node:test can drive it; the proxy supplies the real probes.
// A check returns { id, label, state: "ok"|"warn"|"fail", detail, fix }.

export const CHECKS = [
  {
    id: "node",
    label: "Node.js ≥ 24",
    run: (p) => {
      const major = Number(String(p.nodeVersion || "").replace(/^v/, "").split(".")[0]);
      return major >= 24
        ? ok(`node ${p.nodeVersion}`)
        : fail(`node ${p.nodeVersion || "missing"}`, "Install Node.js 24 or newer (https://nodejs.org), then rerun npm ci.");
    },
  },
  {
    id: "deps",
    label: "npm dependencies installed",
    run: (p) => (p.nodeModules ? ok("node_modules present") : fail("node_modules missing", "npm ci")),
  },
  {
    id: "git",
    label: "git available and inside the repository",
    run: (p) => (p.gitVersion ? ok(p.gitVersion) : fail("git not found", "Install git and open the HQ from the repository root.")),
  },
  {
    id: "hooks",
    label: "git hooks path points at .githooks",
    run: (p) => (p.hooksPath === ".githooks" ? ok("core.hooksPath=.githooks") : warn(`core.hooksPath=${p.hooksPath || "(unset)"}`, "git config core.hooksPath .githooks")),
  },
  {
    id: "descriptor",
    label: "ProjectA Control API descriptor found",
    run: (p) =>
      p.descriptorPath
        ? ok(p.descriptorPath)
        : warn("projecta-api.json not found in any candidate directory", "Start the desktop app (npm run tauri dev) or set PROJECTA_API_DESCRIPTOR to the descriptor path."),
  },
  {
    id: "api",
    label: "Control API answers",
    run: (p) => {
      if (!p.descriptorPath) return warn("skipped — no descriptor", "See the descriptor check above.");
      return p.apiReachable ? ok(`GET /api/projects → ${p.apiStatus}`) : fail(`GET /api/projects → ${p.apiStatus || "no answer"}`, "The descriptor is stale or the app died. Restart ProjectA; the descriptor is rewritten on start.");
    },
  },
  {
    id: "agents",
    label: "agents.json sits next to a ProjectA executable",
    run: (p) => (p.exeFound ? ok(p.agentsFile) : warn(`${p.agentsFile} — no executable beside it`, "Build the app once (npm run tauri build / cargo build) or set PROJECTA_AGENTS_FILE to the agents.json beside the exe you run.")),
  },
  {
    id: "cargo",
    label: "Rust toolchain for the pre-commit gates",
    run: (p) => (p.cargoVersion ? ok(p.cargoVersion) : warn("cargo not found", "Install rustup (https://rustup.rs); the pre-commit hook runs cargo fmt/check.")),
  },
  {
    id: "gtk",
    label: "GTK/WebKit dev libraries (Linux only)",
    run: (p) => {
      if (p.platform !== "linux") return ok("not needed on this platform");
      return p.gtkFound ? ok("gdk-3.0 + webkit2gtk-4.1 via pkg-config") : warn("pkg-config cannot find gdk-3.0", "apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev");
    },
  },
  {
    id: "chromium",
    label: "Chromium for the HQ browser tests",
    run: (p) => (p.chromium ? ok(p.chromium) : warn("no Chromium found", "npx playwright install chromium — or set HQ_CHROMIUM to an existing chrome binary.")),
  },
  {
    id: "specs",
    label: "Spec gate (STAND ⇄ Status: aktiv)",
    run: (p) => (p.specsGateOk ? ok(`${p.activeSpecs} active specs`) : fail(p.specsGateError || "npm run specs failed", "npm run specs — fix the STAND/spec disagreement it names.")),
  },
];

function ok(detail) { return { state: "ok", detail, fix: null }; }
function warn(detail, fix) { return { state: "warn", detail, fix }; }
function fail(detail, fix) { return { state: "fail", detail, fix }; }

export function runSetupChecks(probes) {
  const checks = CHECKS.map((check) => {
    try {
      return { id: check.id, label: check.label, ...check.run(probes) };
    } catch (error) {
      return { id: check.id, label: check.label, state: "fail", detail: error.message, fix: null };
    }
  });
  const counts = { ok: 0, warn: 0, fail: 0 };
  for (const c of checks) counts[c.state]++;
  const ready = counts.fail === 0;
  return {
    ready,
    summary: ready
      ? counts.warn ? `${counts.ok} ok · ${counts.warn} to improve` : "everything set"
      : `${counts.fail} blocking · ${counts.warn} to improve`,
    counts,
    checks,
    fixScript: checks.filter((c) => c.fix && /^[a-z]/.test(c.fix) && !/\s(Install|See|The|Start|Build)\b/.test(c.fix) && !c.fix.includes("(http")).map((c) => c.fix),
  };
}
