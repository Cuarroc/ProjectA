// SETUP-08b: erledigt-row builds the ERLEDIGT line from gh data (fake gh).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { makeRow, insertRow, main } from "../dev/erledigt-row.mjs";

const root = resolve(import.meta.dirname, "../..");
const PR = {
  number: 106,
  title: "feat(api): Windows-ACL-Verifikation der scoped Credentials",
  state: "MERGED",
  mergedAt: "2026-09-24T21:30:00Z",
  mergeCommit: { oid: "2caa3bd0123456789abcdef0123456789abcdef0" },
  files: [{ path: "src-tauri/src/x.rs" }, { path: ".pa/report_w2-07.md" }, { path: ".pa/review_w2-07_kimi-k3.md" }],
};
const cells = (line) => line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/);

test("erledigt-row formats a row like the existing ERLEDIGT rows", () => {
  const row = makeRow({ pr: PR, id: "W2-07" });
  assert.equal(
    row,
    "| 24.09. | W2-07 | Windows-ACL-Verifikation der scoped Credentials | [#106](https://github.com/Cuarroc/ProjectA/pull/106) | 2caa3bd | .pa/report_w2-07.md |",
  );
});

test("erledigt-row drops the package ID and the commit type from the PR title", () => {
  assert.match(makeRow({ pr: { ...PR, title: "W2-07: Windows-ACL" }, id: "W2-07" }), /\| W2-07 \| Windows-ACL \|/);
  assert.match(makeRow({ pr: { ...PR, title: "feat(dev): Helfer (SETUP-08a)" }, id: "SETUP-08a" }), /\| SETUP-08a \| Helfer \|/);
});

test("erledigt-row uses the UTC merge date", () => {
  const row = makeRow({ pr: { ...PR, mergedAt: "2026-09-24T23:30:00Z" }, id: "X-1" });
  assert.match(row, /^\| 24\.09\. \|/);
});

test("erledigt-row escapes pipes and falls back to a dash without report", () => {
  const row = makeRow({ pr: { ...PR, title: "a | b", files: [] }, id: "X-1" });
  assert.match(row, /\| a \\\| b \|/);
  assert.match(row, /\| — \|$/);
});

test("erledigt-row matches the column count of the real docs/ERLEDIGT.md header", () => {
  const text = readFileSync(join(root, "docs/ERLEDIGT.md"), "utf8");
  const header = text.split(/\r?\n/).find((l) => l.startsWith("| Datum |"));
  assert.ok(header, "Kopfzeile in docs/ERLEDIGT.md");
  assert.equal(cells(makeRow({ pr: PR, id: "W2-07" })).length, cells(header).length);
});

test("insertRow puts the row directly under the table header and keeps line endings", () => {
  const text = "# T\r\n\r\n| Datum | ID | Titel | PR | Merge-SHA | Report |\r\n|---|---|---|---|---|---|\r\n| 23.09. | A | a | [#1](https://github.com/Cuarroc/ProjectA/pull/1) | abc1234 | — |\r\n";
  const res = insertRow(text, "| 24.09. | B | b | [#2](https://github.com/Cuarroc/ProjectA/pull/2) | def5678 | — |", { prNumber: 2, id: "B" });
  const lines = res.text.split("\r\n");
  assert.equal(lines[4], "| 24.09. | B | b | [#2](https://github.com/Cuarroc/ProjectA/pull/2) | def5678 | — |");
  assert.equal(lines[5].slice(0, 10), "| 23.09. |");
  assert.equal(res.already, false);
});

test("insertRow is idempotent for the same PR and ID", () => {
  const text = "| Datum | ID | Titel | PR | Merge-SHA | Report |\n|---|---|---|---|---|---|\n| 24.09. | B | b | [#2](https://github.com/Cuarroc/ProjectA/pull/2) | def5678 | — |\n";
  const res = insertRow(text, "| 24.09. | B | b | [#2](https://github.com/Cuarroc/ProjectA/pull/2) | def5678 | — |", { prNumber: 2, id: "B" });
  assert.equal(res.already, true);
  assert.equal(res.text, text);
});

function fakeGh(pr) {
  return (cmd, args) => (cmd === "gh" && args[0] === "pr" && args[1] === "view" ? { code: 0, stdout: JSON.stringify(pr), stderr: "" } : { code: 1, stdout: "", stderr: "unexpected" });
}

test("erledigt-row is a dry run by default and writes only with --apply", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "dev-erledigt-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "ERLEDIGT.md");
  const before = "| Datum | ID | Titel | PR | Merge-SHA | Report |\n|---|---|---|---|---|---|\n";
  writeFileSync(file, before);
  const out = [];
  const io = { out: (s) => out.push(s), err: (s) => out.push(s) };
  assert.equal(await main(["106", "W2-07", "--file", file], io, { run: fakeGh(PR) }), 0);
  assert.equal(readFileSync(file, "utf8"), before);
  assert.match(out.join(""), /Probelauf/);
  assert.equal(await main(["106", "W2-07", "--file", file, "--apply"], io, { run: fakeGh(PR) }), 0);
  assert.match(readFileSync(file, "utf8"), /\| W2-07 \|/);
});

test("erledigt-row refuses a PR that is not merged", async () => {
  const out = [];
  const io = { out: (s) => out.push(s), err: (s) => out.push(s) };
  assert.equal(await main(["106", "W2-07", "--file", "unused.md"], io, { run: fakeGh({ ...PR, state: "OPEN", mergedAt: null, mergeCommit: null }) }), 3);
});

test("erledigt-row validates its arguments", async () => {
  const out = [];
  const io = { out: (s) => out.push(s), err: (s) => out.push(s) };
  assert.equal(await main([], io), 2);
  assert.equal(await main(["x", "W2-07"], io), 2);
  assert.equal(await main(["--help"], io), 0);
});

// --- Review SETUP-08b (kimi-k3 #1, #9; glm-5.2 #5, #6) ---

const HEAD2 = "| Datum | ID | Titel | PR | Merge-SHA | Report |\n|---|---|---|---|---|---|\n";
const ROW = (pr, id) => `| 24.09. | ${id} | t | [#${pr}](https://github.com/Cuarroc/ProjectA/pull/${pr}) | abc1234 | — |`;

test("insertRow is idempotent for a multi-ID row of the same PR (kimi #1)", () => {
  const text = `${HEAD2}${ROW(150, "W1-05, W1-06")}\n`;
  const res = insertRow(text, ROW(150, "W1-05"), { prNumber: 150, id: "W1-05" });
  assert.equal(res.already, true);
  assert.equal(res.text, text);
  assert.equal(insertRow(text, ROW(150, "W1-06"), { prNumber: 150, id: "W1-06" }).already, true);
});

test("insertRow recognises the PR by number even with an older link format (kimi #1)", () => {
  const text = `${HEAD2}| 24.09. | W1-05 | t | [#150](https://github.com/Cuarroc/ProjectA/pull/150/) | abc1234 | — |\n`;
  assert.equal(insertRow(text, ROW(150, "W1-05"), { prNumber: 150, id: "W1-05" }).already, true);
  const plain = `${HEAD2}| 24.09. | w1-05 | t | #150 | abc1234 | — |\n`;
  assert.equal(insertRow(plain, ROW(150, "W1-05"), { prNumber: 150, id: "W1-05" }).already, true);
});

test("insertRow still adds a row for another PR, another ID or a longer PR number (kimi #1)", () => {
  const text = `${HEAD2}${ROW(150, "W1-05, W1-06")}\n`;
  assert.equal(insertRow(text, ROW(150, "W1-07"), { prNumber: 150, id: "W1-07" }).already, false);
  assert.equal(insertRow(text, ROW(15, "W1-05"), { prNumber: 15, id: "W1-05" }).already, false);
  assert.equal(insertRow(text, ROW(1500, "W1-05"), { prNumber: 1500, id: "W1-05" }).already, false);
});

test("insertRow refuses a file without the ERLEDIGT table (glm #6)", () => {
  assert.throws(() => insertRow("# nur Text\n", ROW(1, "A"), { prNumber: 1, id: "A" }), /Tabelle/);
  assert.throws(() => insertRow("| Datum | ID |\nkeine Trennzeile\n", ROW(1, "A"), { prNumber: 1, id: "A" }), /Tabelle/);
});

async function runMain(argv, pr) {
  const out = [];
  const err = [];
  const code = await main(argv, { out: (s) => out.push(s), err: (s) => err.push(s) }, { run: fakeGh(pr) });
  return { code, out: out.join(""), err: err.join("") };
}

test("erledigt-row --apply refuses a missing file and a file without table with exit 3 (glm #6)", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "dev-erledigt-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const missing = join(dir, "fehlt.md");
  assert.equal((await runMain(["106", "W2-07", "--file", missing, "--apply"], PR)).code, 3);
  const bad = join(dir, "bad.md");
  writeFileSync(bad, "# nichts\n");
  assert.equal((await runMain(["106", "W2-07", "--file", bad, "--apply"], PR)).code, 3);
  assert.equal(readFileSync(bad, "utf8"), "# nichts\n");
});

test("erledigt-row reports a gh failure as exit 3 (glm #6)", async () => {
  const run = () => ({ code: 1, stdout: "", stderr: "HTTP 502" });
  const err = [];
  const code = await main(["106", "W2-07", "--file", "x.md"], { out: () => {}, err: (s) => err.push(s) }, { run });
  assert.equal(code, 3);
  assert.match(err.join(""), /502/);
});

test("erledigt-row rejects an empty --title instead of silently using the PR title (glm #5)", async () => {
  assert.equal((await runMain(["106", "W2-07", "--title", ""], PR)).code, 2);
  assert.equal((await runMain(["106", "W2-07", "--title", "   "], PR)).code, 2);
  const ok = await runMain(["106", "W2-07", "--title", "Eigener Titel"], PR);
  assert.equal(ok.code, 0);
  assert.match(ok.out, /\| Eigener Titel \|/);
});

test("erledigt-row warns when gh returns 100 files and the report column may be incomplete (kimi #9)", async () => {
  const files = Array.from({ length: 100 }, (_, i) => ({ path: `src/f${i}.rs` }));
  const res = await runMain(["106", "W2-07"], { ...PR, files });
  assert.equal(res.code, 0);
  assert.match(res.err, /100 Dateien/);
  assert.match(res.err, /--report/);
  const explicit = await runMain(["106", "W2-07", "--report", ".pa/report_x.md"], { ...PR, files });
  assert.equal(explicit.err, "");
  assert.equal((await runMain(["106", "W2-07"], PR)).err, "");
});
