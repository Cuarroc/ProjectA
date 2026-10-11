// @vitest-environment node
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createRunLog } from "./runLog";

test("writes one step entry with a screenshot path per step", async () => {
  const root = await mkdtemp(join(tmpdir(), "shell-log-test-"));
  try {
    const log = await createRunLog(root);
    const capture = async (path: string) => writeFile(path, "screenshot fixture");
    await log.record({ route: "/leitstand", status: "passed", errors: [] }, capture);
    expect(JSON.parse(await readFile(join(log.directory, "steps.json"), "utf8"))).toEqual([
      { step: 1, route: "/leitstand", status: "passed", errors: [], screenshot: "001.png" },
    ]);
    await log.record({ route: "/start", status: "failed", errors: ["render failed"] }, capture);
    expect(JSON.parse(await readFile(join(log.directory, "steps.json"), "utf8"))).toEqual([
      { step: 1, route: "/leitstand", status: "passed", errors: [], screenshot: "001.png" },
      { step: 2, route: "/start", status: "failed", errors: ["render failed"], screenshot: "002.png" },
    ]);
    expect((await readdir(log.directory)).sort()).toEqual(["001.png", "002.png", "steps.json"]);
    expect(await readFile(join(log.directory, "002.png"), "utf8")).toBe("screenshot fixture");
    const next = await createRunLog(root);
    expect(next.directory).not.toBe(log.directory);
    expect(JSON.parse(await readFile(join(next.directory, "steps.json"), "utf8"))).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
