import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  });
});
