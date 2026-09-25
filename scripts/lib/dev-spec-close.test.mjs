// SETUP-08b: spec-close marks a spec historic and removes its STAND line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listedInStand } from "./active-specs.mjs";
import { closeSpec, removeFromStand, specName, main } from "../dev/spec-close.mjs";

const STAND = [
  "# Stand",
  "",
  "## Aktive Specs",
  "",
  "- `.pa/task_devflow.md`: DEVFLOW-Ausführung.",
  "",
  "| Spec | Paket | Lane |",
  "|---|---|---|",
  "| `.pa/task_w1-05.md` | W1-05b: Queue | parallel |",
  "| `.pa/task_w1-05b.md` | nur zum Test: aehnlicher Name | parallel |",
  "| `.pa/task_w1-22.md` | W1-22: tauri-plugin-log | seriell `main.rs` |",
  "",
  "## Bewusst offene Produktbefunde",
  "",
  "- `.pa/task_w1-22.md` wird hier nur erwaehnt und bleibt stehen.",
  "",
].join("\n");

test("specName accepts id, file name and path", () => {
  assert.equal(specName("w1-22"), "task_w1-22.md");
  assert.equal(specName("task_w1-22.md"), "task_w1-22.md");
  assert.equal(specName(".pa/task_w1-22.md"), "task_w1-22.md");
  assert.throws(() => specName("../x"));
});

test("removeFromStand removes only the exact spec line inside Aktive Specs", () => {
  const res = removeFromStand(STAND, "task_w1-05.md");
  assert.equal(res.removed.length, 1);
  assert.match(res.text, /task_w1-05b\.md/);
  assert.doesNotMatch(res.text, /\| `\.pa\/task_w1-05\.md` \|/);
  assert.deepEqual(listedInStand(res.text).names, ["task_devflow.md", "task_w1-05b.md", "task_w1-22.md"]);
});

test("removeFromStand leaves mentions outside the section alone", () => {
  const res = removeFromStand(STAND, "task_w1-22.md");
  assert.equal(res.removed.length, 1);
  assert.match(res.text, /wird hier nur erwaehnt/);
});

test("closeSpec sets the status line to historisch and keeps CRLF", () => {
  const res = closeSpec("# Spec\r\n\r\nStatus: aktiv\r\nText\r\n");
  assert.equal(res.text, "# Spec\r\n\r\nStatus: historisch\r\nText\r\n");
  assert.equal(res.previous, "aktiv");
  assert.equal(res.changed, true);
});

test("closeSpec refuses a spec without exactly one status line in its head", () => {
  assert.throws(() => closeSpec("# Spec\nText\n"));
  assert.throws(() => closeSpec("Status: aktiv\nStatus: entwurf\n"));
});

function repo(t) {
  const dir = mkdtempSync(join(tmpdir(), "dev-spec-close-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, ".pa"));
  writeFileSync(join(dir, "STAND.md"), STAND);
  writeFileSync(join(dir, ".pa/task_w1-22.md"), "# W1-22\n\nStatus: aktiv\n\nText\n");
  return dir;
}

test("spec-close is a dry run by default and changes both files with --apply", async (t) => {
  const dir = repo(t);
  const out = [];
  const io = { out: (s) => out.push(s), err: (s) => out.push(s) };
  assert.equal(await main(["w1-22", "--root", dir], io), 0);
  assert.match(readFileSync(join(dir, ".pa/task_w1-22.md"), "utf8"), /Status: aktiv/);
  assert.match(out.join(""), /Probelauf/);
  assert.equal(await main(["w1-22", "--root", dir, "--apply"], io), 0);
  assert.match(readFileSync(join(dir, ".pa/task_w1-22.md"), "utf8"), /Status: historisch/);
  assert.ok(!listedInStand(readFileSync(join(dir, "STAND.md"), "utf8")).names.includes("task_w1-22.md"));
  assert.match(out.join(""), /npm run hq/);
});

test("spec-close --hq runs the HQ generator through the runner", async (t) => {
  const dir = repo(t);
  const calls = [];
  const run = (cmd, args, opts) => {
    calls.push([cmd, ...args, opts?.cwd]);
    return { code: 0, stdout: "", stderr: "" };
  };
  const io = { out: () => {}, err: () => {} };
  assert.equal(await main(["w1-22", "--root", dir, "--apply", "--hq"], io, { run }), 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], "scripts/dev-hq.mjs");
  assert.equal(calls[0].at(-1), dir);
});

test("spec-close refuses a missing spec", async (t) => {
  const dir = repo(t);
  const io = { out: () => {}, err: () => {} };
  assert.equal(await main(["w9-99", "--root", dir, "--apply"], io), 3);
});

test("spec-close --help exits 0", async () => {
  const out = [];
  assert.equal(await main(["--help"], { out: (s) => out.push(s), err: (s) => out.push(s) }), 0);
  assert.match(out.join(""), /spec-close/);
});

// --- Review SETUP-08b (kimi-k3 #3, #10; glm-5.2 #6) ---

test("closeSpec refuses a status line with a suffix instead of dropping it (kimi #10)", () => {
  assert.throws(() => closeSpec("# Spec\nStatus: aktiv ( gebunden an PR #150 )\n"), /Status/);
  assert.throws(() => closeSpec("# Spec\nStatus: aktiv, Stand 24.09.\n"), /Status/);
  assert.equal(closeSpec("# Spec\nStatus: aktiv\n").text, "# Spec\nStatus: historisch\n");
  assert.equal(closeSpec("# Spec\nStatus:   entwurf  \n").previous, "entwurf");
});

test("spec-close leaves everything alone when the spec is historic and not listed (glm #6)", async (t) => {
  const dir = repo(t);
  writeFileSync(join(dir, ".pa/task_w1-22.md"), "# W1-22\n\nStatus: historisch\n");
  writeFileSync(join(dir, "STAND.md"), "## Aktive Specs\n\n- `.pa/task_devflow.md`: x\n\n## Danach\n");
  const out = [];
  const io = { out: (s) => out.push(s), err: (s) => out.push(s) };
  assert.equal(await main(["w1-22", "--root", dir, "--apply"], io), 0);
  assert.match(out.join(""), /nichts zu tun/);
  assert.equal(readFileSync(join(dir, ".pa/task_w1-22.md"), "utf8"), "# W1-22\n\nStatus: historisch\n");
});

test("spec-close refuses when STAND.md is missing (glm #6)", async (t) => {
  const dir = repo(t);
  rmSync(join(dir, "STAND.md"));
  assert.equal(await main(["w1-22", "--root", dir, "--apply"], { out: () => {}, err: () => {} }), 3);
  assert.match(readFileSync(join(dir, ".pa/task_w1-22.md"), "utf8"), /Status: aktiv/);
});

test("spec-close names the git error instead of falling back to the cwd (kimi #3)", async () => {
  const err = [];
  const run = () => ({ code: 128, stdout: "", stderr: "fatal: not a git repository" });
  const code = await main(["w1-22"], { out: () => {}, err: (s) => err.push(s) }, { run });
  assert.equal(code, 3);
  assert.match(err.join(""), /not a git repository/);
});
