import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeRunner } from "./dev-tools.mjs";
import { main } from "../roadmap-data.mjs";

const now = "2026-10-15T12:00:00Z", page = "roadmap.html";
const table = (title) => `| ID | Ziel | Status |\n|---|---|---|\n| APP-1 | ${title} | Geplant |`;
const release = { tagName: "v1.0.0", publishedAt: "2026-10-01T00:00:00Z", isDraft: false, isPrerelease: false };

// The write branch works on the current directory, so it runs inside a throwaway repository whose origin/main is HEAD.
async function inRepo({ ignore = `.pa/${page}\n`, title = "Search", withPlanCheck = false, setup = () => {}, args = ["--page"], planCheck, fake = () => undefined }, check) {
  const dir = mkdtempSync(join(tmpdir(), "roadmap-page-")), cwd = process.cwd(), real = makeRunner(), out = [], errors = [];
  try {
    const git = (...a) => assert.equal(real("git", ["-C", dir, ...a]).code, 0);
    const commit = (msg) => git("-c", "user.name=t", "-c", "user.email=t@users.noreply.github.com", "commit", "-q", "-m", msg);
    git("init", "-q");
    mkdirSync(join(dir, "docs/plan/v2.0"), { recursive: true });
    writeFileSync(join(dir, "docs/PLAN.md"), table(title));
    if (withPlanCheck) { writeFileSync(join(dir, "docs/plan/v2.0/plan.md"), ""); writeFileSync(join(dir, "docs/decisions.md"), ""); }
    writeFileSync(join(dir, ".gitignore"), ignore);
    git("add", ".");
    commit("plan: first");
    setup(dir, git, commit);
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    process.chdir(dir);
    const run = (cmd, args) => fake(cmd, args) ?? (cmd === "git" ? real(cmd, args) : { code: 0, stdout: JSON.stringify(args[0] === "release" ? [release] : []) });
    const code = await main(args, { out: (s) => out.push(s), err: (s) => errors.push(s) }, { run, now, planCheck });
    check({ code, out: out.join(""), errors: errors.join("") }, dir);
  } finally { process.chdir(cwd); rmSync(dir, { recursive: true, force: true }); }
}

test("roadmap page command writes .pa/roadmap.html from injected data", async () => {
  await inRepo({ title: "<img src=x onerror=alert(1)>", withPlanCheck: true }, ({ code, out }, dir) => {
    const html = readFileSync(join(dir, ".pa", page), "utf8");
    assert.equal(code, 0);
    assert.match(out, /^roadmap:page /);
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<h1>Roadmap<\/h1>/);
    assert.match(html, /v1\.0\.0/);
    assert.match(html, /APP-1/);
    assert.ok(!html.includes("<img src=x") && html.includes("&lt;img src=x"));
    assert.doesNotMatch(html, /noch nicht verbunden: das Ergebnis der Plan-Prüfung/);
    assert.equal(existsSync(join(dir, ".pa/roadmap-data.json")), false);
  });
});

test("refuses a tracked or symlinked output path", async (t) => {
  const tracked = { setup: (dir, git, commit) => { mkdirSync(join(dir, ".pa")); writeFileSync(join(dir, ".pa", page), "old"); git("add", "-f", `.pa/${page}`); commit("tracked"); } };
  await inRepo(tracked, ({ code, errors }, dir) => {
    assert.equal(code, 1);
    assert.match(errors, /tracked/);
    assert.equal(readFileSync(join(dir, ".pa", page), "utf8"), "old");
  });
  await inRepo({ ignore: "" }, ({ code, errors }, dir) => {
    assert.equal(code, 1);
    assert.match(errors, /check-ignore/);
    assert.equal(existsSync(join(dir, ".pa")), false);
  });
  const linked = { setup: (dir) => { mkdirSync(join(dir, ".pa")); writeFileSync(join(dir, "victim.txt"), "keep"); symlinkSync(join(dir, "victim.txt"), join(dir, ".pa", page)); } };
  // Windows without Developer Mode or admin cannot create symlinks; Linux CI must still run that case.
  const skip = process.platform === "win32" && "symlinks need privilege on win32";
  await t.test("symlinked output path", { skip }, () => inRepo(linked, ({ code, errors }, dir) => {
    assert.equal(code, 1);
    assert.match(errors, /symlink/);
    assert.equal(readFileSync(join(dir, "victim.txt"), "utf8"), "keep");
  }));
});

test("plan changes come from the PLAN git log newest first", async () => {
  const setup = (dir, git, commit) => {
    writeFileSync(join(dir, "other.txt"), "x"); git("add", "."); commit("other: not a plan change");
    writeFileSync(join(dir, "docs/PLAN.md"), table("Search v2")); git("add", "."); commit("plan: <b>second</b>");
  };
  await inRepo({ setup }, ({ code }, dir) => {
    const html = readFileSync(join(dir, ".pa", page), "utf8"), second = html.indexOf("plan: &lt;b&gt;second&lt;/b&gt;"), first = html.indexOf("plan: first");
    assert.equal(code, 0);
    assert.ok(second > 0 && first > second, "newest PLAN commit comes first");
    assert.ok(!html.includes("other: not a plan change"));
    assert.match(html, /<time>\d{4}-\d{2}-\d{2}<\/time> plan: &lt;b&gt;second/);
    // Without docs/plan/v2.0 on origin/main the plan check cannot run: the page must say so instead of claiming no defects.
    assert.match(html, /noch nicht verbunden: das Ergebnis der Plan-Prüfung/);
  });
});

test("malformed plan check output leaves findings unknown", async () => {
  for (const output of ["", "not json", "[1]"]) {
    const planCheck = async (_argv, io) => { io.out(output); return 0; };
    await inRepo({ planCheck, withPlanCheck: true }, ({ code, errors }, dir) => {
      assert.equal(code, 0, errors);
      assert.match(readFileSync(join(dir, ".pa", page), "utf8"), /noch nicht verbunden: das Ergebnis der Plan-Prüfung/);
    });
  }
});

test("git log lines without a tab are skipped", async () => {
  const fake = (cmd, args) => cmd === "git" && args[0] === "log" ? { code: 0, stdout: "garbage line\n2026-10-14\tplan: kept\n" } : undefined;
  await inRepo({ fake }, ({ code }, dir) => {
    const html = readFileSync(join(dir, ".pa", page), "utf8");
    assert.equal(code, 0);
    assert.ok(html.includes("plan: kept") && !html.includes("garbage line"));
  });
});

test("page and stdout together print html and write no file", async () => {
  await inRepo({ args: ["--page", "--stdout"], ignore: "" }, ({ code, out }, dir) => {
    assert.equal(code, 0);
    assert.match(out, /^<!doctype html>/);
    assert.equal(existsSync(join(dir, ".pa")), false);
  });
});
