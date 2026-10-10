import { expect, it } from "vitest";

import { cliKey, cliLabel } from "./personas";

it("normalises a command path to its executable key", () => {
  expect(cliKey("C:\\Tools\\codex.exe")).toBe("codex");
  expect(cliKey("/usr/bin/claude")).toBe("claude");
  expect(cliKey("kimi.cmd")).toBe("kimi");
  expect(cliKey("Run\\OpenCode.BAT")).toBe("opencode");
});

it("labels a known CLI by its key and leaves an unknown one unchanged", () => {
  expect(cliLabel("C:\\Tools\\codex.exe")).toBe("Codex");
  expect(cliLabel("/opt/bin/mycli")).toBe("mycli");
});

it("never reads an inherited object property as a CLI label", () => {
  expect(cliLabel("/opt/bin/constructor")).toBe("constructor");
  expect(cliLabel("toString.exe")).toBe("tostring");
});
