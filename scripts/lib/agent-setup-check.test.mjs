// SETUP-02: the agent setup check must be provable without this machine.
// Every test injects a fake environment — no binary is spawned, no network is
// touched, no path separator is assumed — so the file runs the same in
// `npm run test:hq` on Windows and on the Linux CI runner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  CHECKS,
  REVIEWER_MODELS,
  BUILD_SLOTS,
  REQUIRED_BINARIES,
  OPTIONAL_BINARIES,
  parseOllamaList,
  evaluate,
  exitCode,
  collect,
  formatText,
  main,
} from "../dev/agent-setup-check.mjs";

const SKILL = "---\nname: projecta-workflow\ndescription: x\n---\nbody\n";

const healthy = {
  platform: "win32",
  nodeVersion: "v24.19.0",
  binaries: {
    git: "git version 2.51.0",
    gh: "gh version 2.97.0",
    cargo: "cargo 1.98.0",
    "cargo-nextest": "cargo-nextest 0.9.146",
    python: "Python 3.13.14",
    claude: "2.3.0 (Claude Code)",
    codex: "codex-cli 0.154.0",
    opencode: "1.18.32",
    kimi: "kimi, version 2.0.0",
    ollama: "ollama version is 0.30.1",
  },
  agentsMd: true,
  claudeMd: "@AGENTS.md\n\n# CLAUDE.md\n",
  hooksPath: ".githooks",
  skillAgents: SKILL,
  skillClaude: SKILL,
  configs: {
    claudeSettings: true,
    codexConfig: true,
    opencodeConfig: true,
    kimiConfig: true,
    kimiCredentials: true,
  },
  ollamaModels: ["kimi-k3:cloud", "glm-5.2:cloud", "qwen3.8:latest"],
  ghAuth: true,
  slotRoot: "/slots",
  slots: { "projecta-a": true, "projecta-b": true, "projecta-c": true },
};

const byId = (result, id) => result.checks.find((c) => c.id === id);

test("healthy machine passes every mandatory check", () => {
  const result = evaluate(healthy);
  assert.equal(result.ok, true);
  assert.equal(result.counts.fail, 0);
  assert.equal(result.checks.length, CHECKS.length);
  assert.ok(
    result.checks.every((c) => c.state === "ok"),
    JSON.stringify(result.checks.filter((c) => c.state !== "ok")),
  );
  assert.equal(exitCode(result), 0);
});

test("missing AGENTS import in CLAUDE.md is a mandatory failure", () => {
  const result = evaluate({ ...healthy, claudeMd: "# CLAUDE.md\n\nLies AGENTS.md\n" });
  assert.equal(result.ok, false);
  const check = byId(result, "claude-md-import");
  assert.equal(check.state, "fail");
  assert.equal(check.required, true);
  assert.match(check.fix, /@AGENTS\.md/);
  assert.equal(exitCode(result), 1);
});

test("an import that is only mentioned in prose does not count", () => {
  const result = evaluate({ ...healthy, claudeMd: "# CLAUDE.md\n\nUse `@AGENTS.md` some day.\n" });
  assert.equal(byId(result, "claude-md-import").state, "fail");
});

test("diverging skill copies fail and name both paths", () => {
  const result = evaluate({ ...healthy, skillClaude: SKILL + "drift\n" });
  const check = byId(result, "skill-copies");
  assert.equal(check.state, "fail");
  assert.match(check.detail, /\.agents\/skills\/projecta-workflow\/SKILL\.md/);
  assert.match(check.detail, /\.claude\/skills\/projecta-workflow\/SKILL\.md/);
  assert.equal(result.ok, false);
});

test("line ending differences between skill copies are not drift", () => {
  const result = evaluate({ ...healthy, skillClaude: SKILL.replace(/\n/g, "\r\n") });
  assert.equal(byId(result, "skill-copies").state, "ok");
});

test("a missing skill copy fails", () => {
  const result = evaluate({ ...healthy, skillAgents: null });
  assert.equal(byId(result, "skill-copies").state, "fail");
});

test("hooks path accepts the relative and the absolute githooks form", () => {
  assert.equal(byId(evaluate(healthy), "hooks-path").state, "ok");
  const abs = evaluate({ ...healthy, hooksPath: "C:\\Users\\x\\ProjectA\\.githooks" });
  assert.equal(byId(abs, "hooks-path").state, "ok");
  const unset = evaluate({ ...healthy, hooksPath: null });
  assert.equal(byId(unset, "hooks-path").state, "fail");
  assert.match(byId(unset, "hooks-path").fix, /dev:setup|core\.hooksPath/);
});

test("old node fails, missing optional harness only warns", () => {
  const result = evaluate({
    ...healthy,
    nodeVersion: "v22.1.0",
    binaries: { ...healthy.binaries, kimi: null, opencode: null },
  });
  assert.equal(byId(result, "node").state, "fail");
  assert.equal(byId(result, "bin-kimi").state, "warn");
  assert.equal(byId(result, "bin-opencode").state, "warn");
  assert.equal(result.counts.fail, 1);
  assert.equal(exitCode(result), 1);
});

test("missing reviewer model warns with the pull command and never fails", () => {
  const result = evaluate({ ...healthy, ollamaModels: ["kimi-k3:cloud"] });
  const check = byId(result, "reviewer-models");
  assert.equal(check.state, "warn");
  assert.equal(check.required, false);
  assert.match(check.detail, /glm-5\.2:cloud/);
  assert.match(check.fix, /ollama pull glm-5\.2:cloud/);
  assert.equal(result.ok, true);
  assert.deepEqual(REVIEWER_MODELS, ["kimi-k3:cloud", "glm-5.2:cloud"]);
});

test("unauthenticated gh and missing build slots are warnings", () => {
  const result = evaluate({ ...healthy, ghAuth: false, slots: { "projecta-a": true } });
  assert.equal(byId(result, "gh-auth").state, "warn");
  const slots = byId(result, "build-slots");
  assert.equal(slots.state, "warn");
  assert.match(slots.detail, /projecta-b/);
  assert.equal(result.ok, true);
  assert.deepEqual(BUILD_SLOTS, ["projecta-a", "projecta-b", "projecta-c"]);
});

test("build slots are not expected on linux", () => {
  const result = evaluate({ ...healthy, platform: "linux", slots: {} });
  assert.equal(byId(result, "build-slots").state, "ok");
});

test("config presence reports names only, never content", () => {
  const result = evaluate({ ...healthy, configs: { ...healthy.configs, kimiCredentials: false } });
  const check = byId(result, "configs");
  assert.equal(check.state, "warn");
  assert.match(check.detail, /\.kimi-code\/credentials/);
  const text = JSON.stringify(result);
  assert.doesNotMatch(text, /api_key|sk-|token=/i);
});

// collect() is the only function that touches the machine; here the machine
// is a fake: a command table and an in-memory file system.
function fakeMachine({ files = {}, dirs = [], commands = {} } = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      root: "/repo",
      home: "/home/u",
      env: {},
      platform: "linux",
      nodeVersion: "v24.19.0",
      exists: (p) => p in files || dirs.includes(p),
      readFile: (p) => {
        if (!(p in files)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        return files[p];
      },
      run: (cmd, args) => {
        calls.push([cmd, ...args].join(" "));
        const hit = commands[[cmd, ...args].join(" ")];
        return hit ?? { status: null, stdout: "", stderr: "", error: new Error("ENOENT") };
      },
    },
  };
}

test("collect reads the repo and machine through injected probes only", () => {
  const ok = (stdout) => ({ status: 0, stdout, stderr: "" });
  const machine = fakeMachine({
    files: {
      [join("/repo", "CLAUDE.md")]: "@AGENTS.md\n",
      [join("/repo", "AGENTS.md")]: "# AGENTS.md\n",
      [join("/repo", ".agents", "skills", "projecta-workflow", "SKILL.md")]: SKILL,
      [join("/repo", ".claude", "skills", "projecta-workflow", "SKILL.md")]: SKILL,
      [join("/home/u", ".codex", "config.toml")]: "secret = 1\n",
    },
    commands: {
      "git --version": ok("git version 2.51.0\n"),
      "git config --get core.hooksPath": ok(".githooks\n"),
      "gh --version": ok("gh version 2.97.0 (2026-09-01)\nhttps://github.com/cli/cli\n"),
      "gh auth status": ok("Logged in\n"),
      "cargo --version": ok("cargo 1.98.0\n"),
      "ollama list": ok("NAME ID SIZE MODIFIED\nkimi-k3:cloud 630e - 5 weeks ago\nglm-5.2:cloud 7e91 - 5 weeks ago\n"),
    },
  });
  const probe = collect(machine.deps);
  assert.equal(probe.claudeMd, "@AGENTS.md\n");
  assert.equal(probe.agentsMd, true);
  assert.equal(probe.hooksPath, ".githooks");
  assert.equal(probe.binaries.gh, "gh version 2.97.0 (2026-09-01)");
  assert.equal(probe.binaries.kimi, null);
  assert.equal(probe.ghAuth, true);
  assert.deepEqual(probe.ollamaModels, ["kimi-k3:cloud", "glm-5.2:cloud"]);
  assert.equal(probe.configs.codexConfig, true);
  assert.equal(probe.configs.kimiConfig, false);
  assert.equal(probe.skillAgents, SKILL);
  // Presence is a boolean: the content of a config file never enters the probe.
  assert.doesNotMatch(JSON.stringify(probe), /secret/);
  // No command may reach out beyond the fixed allow list.
  for (const call of machine.calls) {
    assert.match(call, /^(git|gh|cargo|cargo-nextest|python|claude|codex|opencode|kimi|ollama) /, call);
  }
  const result = evaluate(probe);
  assert.equal(byId(result, "reviewer-models").state, "ok");
});

test("main prints json and returns the exit code without touching the machine", () => {
  const out = [];
  const code = main(["--json"], { probe: () => ({ ...healthy, hooksPath: null }), write: (s) => out.push(s) });
  assert.equal(code, 1);
  const parsed = JSON.parse(out.join(""));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.checks.find((c) => c.id === "hooks-path").state, "fail");
});

test("ollama list output with a notice before the header keeps every model", () => {
  const out = "A new version of Ollama is available\nNAME ID SIZE MODIFIED\nkimi-k3:cloud 630e - 5 weeks ago\nglm-5.2:cloud 7e91 - 5 weeks ago\n";
  assert.deepEqual(parseOllamaList(out), ["kimi-k3:cloud", "glm-5.2:cloud"]);
  assert.deepEqual(parseOllamaList("NAME ID SIZE MODIFIED\n"), []);
  assert.deepEqual(parseOllamaList("Error: could not connect to ollama app\n"), []);
});

test("a missing mandatory binary fails and a missing CLAUDE.md is named", () => {
  const result = evaluate({ ...healthy, binaries: { ...healthy.binaries, git: null }, claudeMd: null });
  assert.equal(byId(result, "bin-git").state, "fail");
  assert.equal(byId(result, "claude-md-import").detail, "CLAUDE.md missing");
  assert.equal(exitCode(result), 1);
});

test("a crashing check fails when mandatory and only warns when optional", () => {
  const result = evaluate({ ...healthy, binaries: null });
  assert.equal(byId(result, "bin-git").state, "fail");
  assert.equal(byId(result, "bin-kimi").state, "warn");
  const crashing = evaluate(
    Object.defineProperty({ ...healthy }, "ollamaModels", {
      get() {
        throw new Error("boom");
      },
    }),
  );
  const check = byId(crashing, "reviewer-models");
  assert.equal(check.state, "warn");
  assert.match(check.detail, /check crashed: boom/);
});

test("reviewer fix names the ollama install when ollama itself is missing", () => {
  const result = evaluate({ ...healthy, binaries: { ...healthy.binaries, ollama: null }, ollamaModels: [] });
  assert.match(byId(result, "reviewer-models").fix, /Install Ollama first/);
});

// defaultRun joins cmd and args into one shell line on Windows. That is only
// safe while every program and argument is a plain literal.
test("every spawned command and argument is a shell-safe literal", () => {
  const safe = /^[A-Za-z0-9._-]+$/;
  for (const [name, spec] of Object.entries({ ...REQUIRED_BINARIES, ...OPTIONAL_BINARIES })) {
    for (const part of [spec.cmd || name, ...spec.args]) assert.match(part, safe, `${name}: ${part}`);
  }
  const machine = fakeMachine();
  collect(machine.deps);
  for (const call of machine.calls) {
    for (const part of call.split(" ")) assert.match(part, safe, call);
  }
});

test("text output marks each state and lists fixes", () => {
  const text = formatText(evaluate({ ...healthy, ghAuth: false }));
  assert.match(text, /\[ok\]/);
  assert.match(text, /\[warn\] gh-auth/);
  assert.match(text, /gh auth login/);
});
