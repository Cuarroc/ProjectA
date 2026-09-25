// scripts/lib/hq-live.test.mjs — Teams/profiles contracts of the live HQ proxy
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  validateProfile,
  upsertProfile,
  readAgentsFile,
  parseBuiltinProfiles,
  mergeProfileViews,
  resolveAgentsFile,
} from "./hq-live-lib.mjs";

// The proxy resolves the API descriptor like Tauri does: APPDATA (Roaming)
// before LOCALAPPDATA on Windows. Asserted against the script source so a
// reorder shows up red here instead of as a 503 in the user's browser.
test("descriptor candidates prefer APPDATA over LOCALAPPDATA", () => {
  const source = readFileSync(join("scripts", "hq-live.mjs"), "utf8");
  const appdataAt = source.indexOf('env.APPDATA, "com.projecta.app"');
  const localAt = source.indexOf('env.LOCALAPPDATA, "com.projecta.app"');
  assert.ok(appdataAt > 0 && localAt > appdataAt, "APPDATA must be searched before LOCALAPPDATA");
  assert.match(source, /Control API is not running — start the app/);
  assert.ok(existsSync(join("scripts", "hq-live.mjs")));
});

// Tauri's app_data_dir on Linux/macOS never lives under APPDATA/LOCALAPPDATA
// — without these, `npm run hq:live` always reported hq_api_unavailable on
// those platforms even with the app running.
test("descriptor candidates cover the Linux and macOS Tauri app-data directories", () => {
  const source = readFileSync(join("scripts", "hq-live.mjs"), "utf8");
  assert.match(source, /XDG_DATA_HOME/);
  assert.match(source, /"Library", "Application Support", "com\.projecta\.app"/);
});

const PROFILE_DEFAULTS = readFileSync(join("src-tauri", "resources", "agent-defaults.json"), "utf8");

test("validateProfile rejects bad ids and missing fields", () => {
  assert.match(validateProfile({}), /id/);
  assert.match(validateProfile({ id: "Bad Id" }), /lowercase/);
  assert.match(validateProfile({ id: "ok-id" }), /name/);
  assert.match(validateProfile({ id: "ok-id", name: " " }), /name/);
  assert.match(validateProfile({ id: "ok-id", name: "N" }), /command/);
  assert.equal(
    validateProfile({ id: "claude-review", name: "Review", command: "claude" }),
    null,
  );
});

test("upsertProfile replaces same id and keeps other entries", () => {
  const doc = { profiles: [{ id: "claude-fast", name: "Old", command: "claude", args: [], env: {}, fallback: null }] };
  const next = upsertProfile(doc, {
    id: "claude-fast",
    name: "Fast Claude",
    command: "claude",
    args: ["--model", "haiku"],
    env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:20128" },
    team: "Review crew",
  });
  assert.equal(next.profiles.length, 1);
  assert.deepEqual(next.profiles[0].args, ["--model", "haiku"]);
  assert.equal(next.profiles[0].team, "Review crew");
  const added = upsertProfile(next, { id: "codex-eye", name: "Codex", command: "codex" });
  assert.equal(added.profiles.length, 2);
  assert.equal(added.profiles[0].id, "claude-fast");
});

// Editing a profile through the HQ form must not drop fields the form does
// not expose (e.g. `caps`, set only by the Rust side) — a naive "rebuild the
// entry from the submitted fields" implementation silently deleted them.
test("upsertProfile preserves fields the form does not expose, like caps", () => {
  const doc = {
    profiles: [{
      id: "claude-fast",
      name: "Old",
      command: "claude",
      args: [],
      env: {},
      fallback: null,
      caps: { readiness: "hooked", dialect: "claude", systemPrompt: "be terse" },
    }],
  };
  const next = upsertProfile(doc, {
    id: "claude-fast",
    name: "Fast Claude",
    command: "claude",
    args: ["--model", "haiku"],
    env: {},
  });
  assert.deepEqual(next.profiles[0].caps, { readiness: "hooked", dialect: "claude", systemPrompt: "be terse" });
});

test("readAgentsFile accepts both wrapped and bare array shapes", () => {
  assert.deepEqual(readAgentsFile("C:/definitely/missing/agents.json"), { profiles: [] });
});

test("parseBuiltinProfiles reads the shared shipped defaults manifest", () => {
  const builtins = parseBuiltinProfiles(PROFILE_DEFAULTS);
  assert.ok(builtins.length >= 4, `expected the shipped agents, got ${builtins.length}`);
  const claude = builtins.find((p) => p.id === "claude");
  assert.equal(claude.command, "claude");
  assert.equal(claude.builtin, true);
  const ollama = builtins.find((p) => p.id === "ollama");
  assert.deepEqual(ollama.args, ["run", "llama3.2"]);
});

test("mergeProfileViews: override replaces builtin by id, customs are grouped", () => {
  const builtins = [{ id: "claude", name: "Claude Code", command: "claude", args: [], builtin: true }];
  const merged = mergeProfileViews(builtins, {
    profiles: [
      { id: "claude", name: "Claude lokal", command: "claude", args: [], env: {}, fallback: null },
      { id: "codex-eye", name: "Codex", command: "codex", args: [], env: {}, fallback: "claude", team: "Review crew" },
    ],
  });
  assert.equal(merged.length, 2);
  assert.equal(merged[0].name, "Claude lokal");
  assert.equal(merged[0].builtin, false);
  assert.equal(merged[1].team, "Review crew");
});

test("resolveAgentsFile honors the explicit env override", () => {
  assert.equal(resolveAgentsFile(".", { PROJECTA_AGENTS_FILE: "C:/x/agents.json" }), "C:/x/agents.json");
});

// A stale debug binary must not shadow a freshly built release one (and vice
// versa) — only the exe that was actually built last is the one a developer
// is running, and only extension-less Linux/macOS binaries exist there too.
test("resolveAgentsFile picks the most recently built binary, debug or release", () => {
  const debugExe = join("root", "src-tauri", "target", "debug", "projecta.exe");
  const releaseExe = join("root", "src-tauri", "target", "release", "projecta");
  const fs = {
    existsSync: (path) => path === debugExe || path === releaseExe,
    statSync: (path) => ({ mtimeMs: path === releaseExe ? 200 : 100 }),
  };
  assert.equal(resolveAgentsFile("root", {}, fs), join("root", "src-tauri", "target", "release", "agents.json"));
});

test("resolveAgentsFile falls back to debug when nothing was built yet", () => {
  const fs = { existsSync: () => false, statSync: () => ({ mtimeMs: 0 }) };
  assert.equal(resolveAgentsFile("root", {}, fs), join("root", "src-tauri", "target", "debug", "agents.json"));
});
