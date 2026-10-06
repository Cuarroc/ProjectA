import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const gate = join(dirname(fileURLToPath(import.meta.url)), "crlf-source-compare.mjs");

function run(files, allow = "") {
  const root = mkdtempSync(join(tmpdir(), "projecta-crlf-compare-"));
  files["scripts/ci/crlf-source-compare.allow"] = allow;
  for (const [path, contents] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  return spawnSync(process.execPath, [gate, "check", root], { encoding: "utf8" });
}

const blind = `#[cfg(test)]
mod tests {
    #[test]
    fn reads_source_blind() {
        let src = include_str!("lib.rs");
        assert!(src.contains("fn a() {\\n    b();"));
    }
}
`;

test("crlf_blind_source_compare_is_red", () => {
  const result = run({ "src/lib.rs": blind });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /src\/lib\.rs:4 fn reads_source_blind/);
});

test("crlf_normalised_source_compare_is_green", () => {
  const fixed = blind.replace('include_str!("lib.rs")', 'include_str!("lib.rs").replace("\\r\\n", "\\n")');
  const result = run({ "src/lib.rs": fixed });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("crlf_newline_literal_without_a_source_read_is_green", () => {
  const plain = blind.replace('include_str!("lib.rs")', 'String::from("x")');
  assert.equal(run({ "src/lib.rs": plain }).status, 0);
});

test("crlf_allow_list_entry_silences_one_function", () => {
  const allow = "src/lib.rs::reads_source_blind\tfixture reason\n";
  assert.equal(run({ "src/lib.rs": blind }, allow).status, 0);
});

test("crlf_nested_helper_belongs_to_its_test", () => {
  const nested = blind.replace("let src =", "fn helper() {}\n        let src =");
  assert.equal(run({ "src/lib.rs": nested }).status, 1);
});

test("crlf_gate_runs_from_a_path_with_a_space", () => {
  const dir = mkdtempSync(join(tmpdir(), "projecta crlf gate "));
  const copy = join(dir, "crlf-source-compare.mjs");
  copyFileSync(gate, copy);
  const root = mkdtempSync(join(tmpdir(), "projecta-crlf-compare-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/lib.rs"), blind);
  const result = spawnSync(process.execPath, [copy, "check", root], { encoding: "utf8" });
  assert.equal(result.status, 1, result.stdout + result.stderr);
});
