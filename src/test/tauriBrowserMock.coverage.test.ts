import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { lookupMockResponse } from "./tauriBrowserMock";

// AP-8a: the browser mock (VITE_TAURI_MOCKS) must answer every IPC command the
// frontend wrappers in src/lib invoke, otherwise the UI shows the raw text
// "browser smoke: unmocked command <name>" (observed: get_provider_overview).
// The scan reads source text, so a new invoke("...") without a mock handler
// turns this test red.
//
// KNOWN_UNMOCKED is shrink-only, like the i18n hardcoded-baseline: it may only
// lose entries. A command that is mocked (or no longer invoked) but still
// listed fails the second test, so the list cannot go stale.
const KNOWN_UNMOCKED: readonly string[] = [];

// Answered directly by the mockIPC handler, ahead of the response tables.
const HANDLER_COMMANDS = ["spawn_pty", "write_pty", "resize_pty", "kill_pty"];

const libDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "lib");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function invokedCommands(): string[] {
  const names = new Set<string>();
  const call = /\binvoke(?:<[^()]*>)?\(\s*"([^"]+)"/g;
  for (const file of sourceFiles(libDir)) {
    for (const match of readFileSync(file, "utf8").matchAll(call)) names.add(match[1]);
  }
  return [...names].sort();
}

function isMocked(command: string): boolean {
  if (HANDLER_COMMANDS.includes(command)) return true;
  try {
    lookupMockResponse(command, false);
    return true;
  } catch {
    return false;
  }
}

describe("tauriBrowserMock coverage of invoked IPC commands", () => {
  const commands = invokedCommands();

  it("scans the wrappers under src/lib", () => {
    expect(commands.length).toBeGreaterThan(100);
    expect(commands).toContain("get_provider_overview");
    expect(commands).toContain("list_projects");
  });

  it("answers every command invoked under src/lib without an unmocked-command error", () => {
    const missing = commands.filter((c) => !isMocked(c) && !KNOWN_UNMOCKED.includes(c));
    expect(missing).toEqual([]);
  });

  it("keeps the known-unmocked allowlist shrink-only (no stale entries)", () => {
    const stale = KNOWN_UNMOCKED.filter((c) => !commands.includes(c) || isMocked(c));
    expect(stale).toEqual([]);
  });
});
