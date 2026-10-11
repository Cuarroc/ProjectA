import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { APPROVAL_WORDS, lint, main } from "../dev/brief-lint.mjs";

const fixture = (name) => fileURLToPath(new URL(`../dev/fixtures/brief-lint/${name}.md`, import.meta.url));
const brief = readFileSync(fixture("complete"), "utf8");
const pr = readFileSync(fixture("pr"), "utf8");
const run = async (args, deps) => {
  let out = "";
  const code = await main(args, { out: (s) => { out += s; }, err: (s) => { out += s; } }, deps);
  return { code, out };
};
test("complete brief exits 0", async () => {
  assert.equal((await run([fixture("complete")])).code, 0);
  assert.deepEqual(lint(brief), { exit: 0, reasons: [], approvals: [] });
});
test("missing acceptance exits 2 with the reason", () => {
  const r = lint(brief.replace(/^ACCEPTANCE:.*$/m, ""));
  assert.equal(r.exit, 2);
  assert.ok(r.reasons.includes("ACCEPTANCE fehlt oder ist leer"));
});
test("approval word outside non-goals exits 3", () => {
  const r = lint("GOAL: Secret\n");
  assert.equal(r.exit, 3);
  assert.deepEqual(r.approvals, [{ word: "Secret", line: 1 }]);
  assert.ok(r.reasons.length > 0);
});
test("pr body line starting with a trailer word exits 2", () => {
  for (const word of ["Test-First", "Regression-For", "No-Test"]) {
    const r = lint(`${word}: example\n${pr}`, { prBody: true });
    assert.equal(r.exit, 2);
    assert.match(r.reasons.join("\n"), /Zeile 1/);
  }
});
test("brief structure rejects empty fields invalid operators bases sizes and trailers", () => {
  for (const field of ["OPERATOR", "GOAL", "NON-GOALS", "BASE", "SEAM", "SIZE", "ACCEPTANCE", "TIER/REVIEW", "RETURN"]) {
    assert.equal(lint(brief.replace(new RegExp(`^${field}:.*$`, "m"), `${field}:`)).exit, 2, field);
  }
  for (const [before, after] of [["UMSETZEN", "DO"], ["36bee03c", "abcdef"], ["300", "301"], ["300", "-1"], ["300", "2.5"], ["scripts/dev/brief-lint.mjs", "none"], ["scripts/lib/dev-brief-lint.test.mjs::complete brief exits 0", "bare_test"]]) {
    assert.equal(lint(brief.replace(before, after)).exit, 2, after);
  }
  assert.equal(lint(brief.replace(/^Test-First:.*$/m, "")).exit, 2);
  assert.equal(lint(brief.replace("Test-First:", "No-Test:")).exit, 0);
  assert.equal(lint(brief.replace("UMSETZEN", "PRÜFEN").replace(/^SIZE:.*$|^Test-First:.*$/gm, "")).exit, 0);
});
test("seam files require a seam declaration", () => {
  for (const path of ["api.rs", "src-tauri/src/main.rs", "store.rs", "src-tauri/src/store/test.rs", "bin/pa.rs"]) {
    const r = lint(brief.replace("scripts/dev/brief-lint.mjs", path));
    assert.equal(r.exit, 2);
    assert.ok(r.reasons.includes("Naht in FILES, aber SEAM: no"));
  }
});
test("approval matching uses word boundaries excludes non-goals and code and keeps quotes", () => {
  assert.equal(lint(brief + "\n```text\nSecret\n```\n~~~\ninstall\n~~~\n    delete\nSecretive Tokens Kostenstelle\n").exit, 0);
  for (const word of ["Geld", "Kosten", "kaufen", "bezahlen", "löschen", "delete", "Release", "Tag veröffentlichen", "installieren", "install", "Secret", "Schlüssel", "Token", "Passwort", "Rechte ändern", "Berechtigung ändern"]) {
    assert.ok(APPROVAL_WORDS.includes(word));
    assert.equal(lint(brief + `\n> ${word.toUpperCase()}`).exit, 3, word);
  }
});
test("pr reports require report uncovered block and completed review", () => {
  assert.equal(lint(pr, { prBody: true }).exit, 0);
  for (const text of [pr.replace("## Report", "Report"), pr.replace("NICHT ABGEDECKT", "Coverage"), pr.replace("abgeschlossen", "ausstehend")]) {
    assert.equal(lint(text, { prBody: true }).exit, 2);
  }
  assert.ok(lint(pr.replace("abgeschlossen", "ausstehend"), { prBody: true }).reasons.includes("Review fehlt"));
});
test("json cli and repo validation preserve exit codes and argument arrays", async () => {
  const cli = fileURLToPath(new URL("../dev/brief-lint.mjs", import.meta.url));
  const child = spawnSync(process.execPath, [cli, "--json", fixture("complete")], { encoding: "utf8" });
  assert.equal(child.status, 0);
  assert.deepEqual(JSON.parse(child.stdout), { exit: 0, reasons: [], approvals: [] });
  assert.equal((await run(["--pr-body", fixture("pr")])).code, 0);
  for (const code of [0, 1]) {
    const r = await run(["--repo", "repo with spaces", "--json", fixture("complete")], { run: (cmd, args) => {
      assert.equal(cmd, "git");
      assert.deepEqual(args, ["-C", "repo with spaces", "cat-file", "-e", "36bee03c^{commit}"]);
      return { code };
    } });
    assert.equal(r.code, code === 0 ? 0 : 2);
    assert.equal(JSON.parse(r.out).exit, r.code);
  }
  for (const args of [[], ["--unknown"], ["missing-brief.md"], ["--pr-body", fixture("pr"), fixture("complete")]]) assert.equal((await run(args)).code, 2);
});
