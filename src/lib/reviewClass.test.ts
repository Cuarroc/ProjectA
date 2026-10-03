import { describe, expect, it } from "vitest";

import { classifyDiff, classifyPath, reviewClassInfo } from "./reviewClass";

describe("classifyPath", () => {
  it.each([
    "src-tauri/src/api.rs",
    "src-tauri/src/main.rs",
    "src-tauri/src/store.rs",
    "src-tauri/src/store/queue_cancel.rs",
    "src-tauri/src/bin/pa.rs",
    "src-tauri/src/pty.rs",
    "src-tauri/src/api/agent_access.rs",
    "src-tauri/src/api/credential_acl.rs",
  ])("treats %s as class A", (path) => {
    expect(classifyPath(path)).toBe("A");
  });

  it("treats a migration as class A", () => {
    expect(classifyPath("src-tauri/migrations/0042_add_table.sql")).toBe("A");
  });

  it.each(["docs/PLAN.md", "README.md", "docs/setup/claude-code.md"])(
    "treats pure documentation %s as class C",
    (path) => {
      expect(classifyPath(path)).toBe("C");
    },
  );

  it.each([
    "src/lib/diff.test.ts",
    "src/components/DiffView.test.tsx",
    "src-tauri/src/budget_tests.rs",
    "src-tauri/src/snapshots/projecta__budget__tests__x.snap",
  ])("treats tests and snapshots %s as class C", (path) => {
    expect(classifyPath(path)).toBe("C");
  });

  it.each(["src/components/DiffView.tsx", "src/lib/diff.ts", "src-tauri/src/diff.rs"])(
    "treats ordinary code %s as class B",
    (path) => {
      expect(classifyPath(path)).toBe("B");
    },
  );

  it.each(["Cargo.lock", "package.json", ".github/workflows/ci.yml", "src/notes.md", "LICENSE"])(
    "does not guess for %s",
    (path) => {
      expect(classifyPath(path)).toBe("unknown");
    },
  );
});

describe("classifyDiff", () => {
  it("takes the highest single class of a mixed diff", () => {
    expect(classifyDiff(["docs/PLAN.md", "src/lib/diff.ts", "src-tauri/src/store.rs"])).toBe("A");
    expect(classifyDiff(["docs/PLAN.md", "src/lib/diff.ts"])).toBe("B");
  });

  it("keeps a pure documentation diff at C", () => {
    expect(classifyDiff(["docs/PLAN.md", "STAND.md"])).toBe("C");
  });

  it("lets an unknown path outrank B and C but not A", () => {
    expect(classifyDiff(["src/lib/diff.ts", "Cargo.lock"])).toBe("unknown");
    expect(classifyDiff(["Cargo.lock", "src-tauri/src/api.rs"])).toBe("A");
  });

  it("returns null for an empty diff", () => {
    expect(classifyDiff([])).toBeNull();
  });
});

describe("reviewClassInfo", () => {
  it("explains every class in plain German without calling anything safe", () => {
    for (const cls of ["A", "B", "C", "unknown"] as const) {
      const info = reviewClassInfo(cls);
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.explanation.length).toBeGreaterThan(10);
      expect(`${info.label} ${info.explanation}`).not.toMatch(/\bsicher\b|grün/i);
    }
    expect(reviewClassInfo("A").explanation).toMatch(/zwei Prüfer/);
    expect(reviewClassInfo("unknown").explanation).toMatch(/wie A/);
  });
});
