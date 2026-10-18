import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../..");
const licence = "src/design/icons/LUCIDE-LIZENZ.txt";

describe("Lucide notice", () => {
  it("THIRD_PARTY_NOTICES lists Lucide and the licence file exists", () => {
    const notices = readFileSync(resolve(root, "docs/THIRD_PARTY_NOTICES.md"), "utf8");
    expect(notices).toContain("Lucide");
    expect(notices).toContain(licence);
    expect(existsSync(resolve(root, licence))).toBe(true);
    const text = readFileSync(resolve(root, licence), "utf8");
    expect(text).toContain("ISC License");
    expect(text).toContain("Lucide Icons and Contributors");
    expect(text).toContain("Cole Bemis");
    const glyphs = readFileSync(resolve(root, "src/design/icons/glyphs.ts"), "utf8");
    for (const line of text.split("\n").filter((l) => l.trim())) expect(glyphs).toContain(line);
  });
});

describe("Lucide notice in the production build (R1701-L1)", () => {
  it("a Vite build ships the glyph paths together with both copyright notices", () => {
    const out = mkdtempSync(join(tmpdir(), "pa-lucide-"));
    try {
      execFileSync("npx", ["vite", "build", "--outDir", out, "--emptyOutDir"], { cwd: root, stdio: "pipe" });
      const files = readdirSync(out, { recursive: true, encoding: "utf8" })
        .map((f) => join(out, f))
        .filter((f) => statSync(f).isFile())
        .map((f) => readFileSync(f, "utf8"));
      const some = (needle: string) => files.some((c) => c.includes(needle));
      expect(some("M9.671 4.136a2.34")).toBe(true);
      expect(some("Lucide Icons and Contributors")).toBe(true);
      expect(some("Cole Bemis")).toBe(true);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 120_000);
});
