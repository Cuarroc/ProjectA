import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeRunner, cleanEnv } from "./dev-tools.mjs";
import { main } from "../roadmap-data.mjs";

const now = "2026-10-15T12:00:00Z", page = "roadmap.html";
const table = (title) => `| ID | Ziel | Status |\n|---|---|---|\n| APP-1 | ${title} | Geplant |`;
const release = { tagName: "v1.0.0", publishedAt: "2026-10-01T00:00:00Z", isDraft: false, isPrerelease: false };

// The write branch works on the current directory, so it runs inside a throwaway repository whose origin/main is HEAD.
async function inRepo({ ignore = `.pa/${page}\n`, title = "Search", withPlanCheck = false, setup = () => {}, args = ["--page"], planCheck, fake = () => undefined }, check) {
  const dir = mkdtempSync(join(tmpdir(), "roadmap-page-")), cwd = process.cwd(), real = makeRunner({ env: { ...cleanEnv(), GIT_COMMITTER_DATE: now } }), out = [], errors = [];
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
    if (real("git", ["-C", dir, "remote", "get-url", "origin"]).code !== 0) git("remote", "add", "origin", ".");
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

test("a change line without an ISO date is dropped", async () => {
  const log = "forged\tplan: invented\n2026-13-45\tplan: impossible\n10-14-2026\tplan: wrong order\n2026-10-14\tplan: kept\n";
  const fake = (cmd, args) => cmd === "git" && args[0] === "log" ? { code: 0, stdout: log } : undefined;
  await inRepo({ fake }, ({ code }, dir) => {
    const html = readFileSync(join(dir, ".pa", page), "utf8");
    assert.equal(code, 0);
    assert.ok(html.includes("plan: kept"));
    for (const dropped of ["invented", "impossible", "wrong order"]) assert.ok(!html.includes(dropped), dropped);
  });
});

test("an unparsable plan check writes one diagnostic line and still renders", async () => {
  for (const output of ["", "not json", "[1]"]) {
    const planCheck = async (_argv, io) => { io.out(output); return 0; };
    await inRepo({ planCheck, withPlanCheck: true }, ({ code, errors }, dir) => {
      assert.equal(code, 0, errors);
      assert.equal(errors.split("\n").filter(Boolean).length, 1, errors);
      assert.match(errors, /^roadmap: plan check/);
      assert.ok(!errors.includes(output) || output === "", "no payload dump");
      assert.match(readFileSync(join(dir, ".pa", page), "utf8"), /noch nicht verbunden: das Ergebnis der Plan-Prüfung/);
    });
  }
  const planCheck = async (_argv, io) => { io.out(JSON.stringify({ findings: [] })); return 0; };
  await inRepo({ planCheck, withPlanCheck: true }, ({ errors }) => assert.equal(errors, ""));
});

test("page and stdout together print html and write no file", async () => {
  await inRepo({ args: ["--page", "--stdout"], ignore: "" }, ({ code, out }, dir) => {
    assert.equal(code, 0);
    assert.match(out, /^<!doctype html>/);
    assert.equal(existsSync(join(dir, ".pa")), false);
  });
});

test("page preserves the plan check notChecked list alongside findings", async () => {
  const notChecked = ["GitHub unavailable", "Jobs not observed", "<img src=x>"];
  const planCheck = async (_argv, io) => { io.out(JSON.stringify({ findings: [], notChecked })); return 0; };
  await inRepo({ args: ["--page", "--stdout"], planCheck }, ({ code, out }) => {
    assert.equal(code, 0);
    assert.match(out, /Nicht geprüft/);
    for (const text of ["GitHub unavailable", "Jobs not observed", "&lt;img src=x&gt;"]) assert.ok(out.includes(text), text);
    assert.ok(!out.includes("<img src=x>"));
  });
});

test("CLI records fetch time only for the matching origin main FETCH_HEAD", async () => {
  for (const mode of ["fresh", "old", "missing", "wrong-sha", "wrong-remote", "wrong-branch", "future"]) {
    const setup = (dir, git) => {
      git("branch", "-M", "main"); git("remote", "add", "origin", ".");
      if (mode === "missing") return;
      const time = new Date(mode === "old" ? "2026-10-14T12:00:00Z" : mode === "future" ? "2026-10-16T12:00:00Z" : now);
      const dated = makeRunner({ env: { ...cleanEnv(), GIT_COMMITTER_DATE: time.toISOString() } });
      assert.equal(dated("git", ["-C", dir, "fetch", "-q", "origin", "main"]).code, 0);
      const file = join(dir, ".git/FETCH_HEAD");
      let text = readFileSync(file, "utf8");
      if (mode === "wrong-sha") text = text.replace(/^[a-f0-9]+/, "0".repeat(40));
      if (mode === "wrong-remote") text = text.replace("of .", "of other");
      if (mode === "wrong-branch") text = text.replace("'main'", "'other'");
      writeFileSync(file, text);
      utimesSync(file, time, time);
    };
    await inRepo({ setup, args: ["--stdout"] }, ({ code, out }) => {
      assert.equal(code, 0, mode);
      const { stand } = JSON.parse(out);
      assert.match(stand.mainSha, /^[a-f0-9]{40}$/);
      assert.equal(stand.planRef, "origin/main");
      assert.equal(stand.fetchAgeMs, mode === "fresh" ? 0 : mode === "old" ? 86400000 : null, mode);
      assert.equal(stand.fetchedAt, mode === "fresh" ? "2026-10-15T12:00:00.000Z" : mode === "old" ? "2026-10-14T12:00:00.000Z" : null, mode);
    });
  }
});

test("an unrelated appended fetch cannot refresh origin main evidence", async () => {
  const setup = (dir, git) => {
    git("branch", "-M", "main"); git("branch", "other"); git("remote", "add", "origin", ".");
    const old = makeRunner({ env: { ...cleanEnv(), GIT_COMMITTER_DATE: "2026-10-14T12:00:00Z" } });
    assert.equal(old("git", ["-C", dir, "fetch", "-q", "origin", "main"]).code, 0);
    git("fetch", "-q", "--append", "origin", "other");
    utimesSync(join(dir, ".git/FETCH_HEAD"), new Date(now), new Date(now));
  };
  await inRepo({ setup, args: ["--stdout"] }, ({ code, out }) => {
    assert.equal(code, 0);
    const { stand } = JSON.parse(out);
    assert.equal(stand.fetchedAt, "2026-10-14T12:00:00.000Z");
    assert.equal(stand.fetchAgeMs, 86400000);
  });
});

test("a foreign refspec cannot date historical main evidence as fresh", async () => {
  for (const mainFetch of ["--append", "--no-write-fetch-head"]) {
    const root = mkdtempSync(join(tmpdir(), "roadmap-source-")), cwd = process.cwd();
    const remote = join(root, "remote.git"), seed = join(root, "seed"), client = join(root, "client");
    const clock = "2026-10-21T16:00:00Z";
    const env = { ...cleanEnv(), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null" };
    const git = (dir, args, date = clock) => {
      const r = makeRunner({ env: { ...env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } })("git", ["-C", dir, ...args]);
      assert.equal(r.code, 0, r.stderr);
      return r.stdout.trim();
    };
    try {
      for (const dir of [remote, seed, client]) mkdirSync(dir);
      git(remote, ["init", "--bare", "-q"]);
      git(seed, ["init", "-q", "-b", "main"]);
      mkdirSync(join(seed, "docs"));
      writeFileSync(join(seed, "docs/PLAN.md"), table("A"));
      const commit = () => {
        git(seed, ["add", "."]);
        git(seed, ["-c", "user.name=Fixture", "-c", "user.email=fixture@users.noreply.github.com", "commit", "-q", "-m", "plan"]);
        return git(seed, ["rev-parse", "HEAD"]);
      };
      const a = commit();
      git(seed, ["branch", "other"]);
      git(seed, ["remote", "add", "origin", remote]);
      git(seed, ["push", "-q", "origin", "main", "other"]);
      git(client, ["init", "-q"]);
      git(client, ["remote", "add", "origin", remote]);
      git(client, ["fetch", "-q", "origin", "main"], "2026-10-20T12:00:00Z");
      writeFileSync(join(seed, "docs/PLAN.md"), table("B"));
      const b = commit();
      git(seed, ["push", "-q", "origin", "main"]);
      git(client, ["fetch", "-q", mainFetch, "origin", "main"], "2026-10-21T15:00:00Z");
      git(client, ["fetch", "-q", "--append", "origin", "+other:refs/remotes/origin/main"]);
      assert.notEqual(a, b);
      assert.equal(git(client, ["ls-remote", "origin", "refs/heads/main"]).split("\t")[0], b);
      assert.equal(git(client, ["rev-parse", "origin/main"]), a);
      const fetchHead = readFileSync(join(client, ".git/FETCH_HEAD"), "utf8");
      assert.ok(fetchHead.includes(`${a}\t\tbranch 'main' of `));
      assert.equal(fetchHead.includes(`${b}\t\tbranch 'main' of `), mainFetch === "--append");
      assert.match(git(client, ["reflog", "show", "-1", "--format=%gs", "refs/remotes/origin/main"]), /other:refs\/remotes\/origin\/main/);
      const real = makeRunner({ env });
      const run = (cmd, args) => cmd === "gh" ? { code: 0, stdout: "[]" } : real(cmd, args);
      let out = "", errors = "";
      process.chdir(client);
      const code = await main(["--stdout"], { out: s => { out += s; }, err: s => { errors += s; } }, { run, now: clock });
      const { stand } = JSON.parse(out);
      assert.equal(code, 0, errors);
      assert.equal(errors, "");
      assert.equal(stand.mainSha, a);
      assert.equal(stand.planRef, "origin/main");
      assert.equal(stand.fetchedAt, null, JSON.stringify({ remoteMain: b, localOriginMain: a, code, errors, stand }));
      assert.equal(stand.fetchAgeMs, null);
    } finally { process.chdir(cwd); rmSync(root, { recursive: true, force: true }); }
  }
});

// Real remote namespace changes reproduce R1789-G1 without editing fetch metadata.
async function resolvedFetch(source, suppressHead, check) {
  const root = mkdtempSync(join(tmpdir(), "roadmap-resolved-")), cwd = process.cwd();
  const remote = join(root, "remote.git"), seed = join(root, "seed"), client = join(root, "client");
  const clock = "2026-10-21T16:00:00Z";
  const env = { ...cleanEnv(), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null" };
  const git = (dir, args, date = clock) => {
    const r = makeRunner({ env: { ...env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } })("git", ["-C", dir, ...args]);
    assert.equal(r.code, 0, r.stderr);
    return r.stdout.trim();
  };
  try {
    for (const dir of [remote, seed, client]) mkdirSync(dir);
    git(remote, ["init", "--bare", "-q"]); git(seed, ["init", "-q", "-b", "main"]);
    mkdirSync(join(seed, "docs")); writeFileSync(join(seed, "docs/PLAN.md"), table("A"));
    const commit = () => {
      git(seed, ["add", "."]);
      git(seed, ["-c", "user.name=Fixture", "-c", "user.email=fixture@users.noreply.github.com", "commit", "-q", "-m", "plan"]);
      return git(seed, ["rev-parse", "HEAD"]);
    };
    const a = commit();
    git(seed, ["branch", "other"]); git(seed, ["remote", "add", "origin", remote]);
    git(seed, ["push", "-q", "origin", "main", "other"]);
    git(client, ["init", "-q"]); git(client, ["remote", "add", "origin", remote]);
    git(client, ["fetch", "-q", "origin", "main"], "2026-10-20T12:00:00Z");
    writeFileSync(join(seed, "docs/PLAN.md"), table("B"));
    const b = commit(); git(seed, ["push", "-q", "origin", "main"]);
    git(client, ["fetch", "-q", "--no-write-fetch-head", "origin", "main"], "2026-10-21T15:00:00Z");
    git(remote, ["update-ref", source, a]); git(remote, ["update-ref", "-d", "refs/heads/main"]);
    git(client, ["fetch", "-q", suppressHead ? "--no-write-fetch-head" : "--append", "origin", "+main:refs/remotes/origin/main"]);
    assert.notEqual(a, b);
    assert.equal(git(client, ["ls-remote", "origin", "refs/heads/main"]), "");
    const real = makeRunner({ env }), run = (cmd, args) => cmd === "gh" ? { code: 0, stdout: "[]" } : real(cmd, args);
    let out = "", errors = ""; process.chdir(client);
    const code = await main(["--stdout"], { out: s => { out += s; }, err: s => { errors += s; } }, { run, now: clock });
    const { stand } = JSON.parse(out);
    assert.equal(code, 0, errors); assert.equal(errors, ""); assert.equal(stand.mainSha, a);
    check(stand);
  } finally { process.chdir(cwd); rmSync(root, { recursive: true, force: true }); }
}

test("a resolved non-branch main cannot borrow historical branch freshness", async () => {
  for (const source of ["refs/remotes/main", "refs/main"]) for (const suppress of [false, true]) {
    await resolvedFetch(source, suppress, stand => {
      assert.equal(stand.fetchedAt, null, `${source}, suppress=${suppress}`);
      assert.equal(stand.fetchAgeMs, null);
    });
  }
});

test("a tag named main cannot borrow historical branch freshness", async () => {
  for (const suppress of [false, true]) await resolvedFetch("refs/tags/main", suppress, stand => {
    assert.equal(stand.fetchedAt, null, `suppress=${suppress}`);
    assert.equal(stand.fetchAgeMs, null);
  });
});

test("configured origin fetches are dated only by an unambiguous main mapping", async () => {
  for (const mode of ["default", "origin", "quiet", "exact", "conflict", "ambiguous", "unknown"]) {
    const setup = (_dir, git) => {
      git("branch", "-M", "main"); git("branch", "other"); git("remote", "add", "origin", ".");
      if (mode === "exact") git("config", "remote.origin.fetch", "+refs/heads/main:refs/remotes/origin/main");
      git("fetch", ...(mode === "quiet" ? ["--quiet"] : []), ...(mode === "default" ? [] : ["origin"]));
      if (mode === "conflict") git("config", "remote.origin.fetch", "+refs/heads/other:refs/remotes/origin/main");
      if (mode === "ambiguous") git("config", "--add", "remote.origin.fetch", "+refs/heads/other:refs/remotes/origin/main");
      if (mode === "unknown") git("config", "--unset-all", "remote.origin.fetch");
    };
    await inRepo({ setup, args: ["--stdout"] }, ({ code, out, errors }) => {
      assert.equal(code, 0, errors);
      const { stand } = JSON.parse(out), known = ["default", "origin", "quiet", "exact"].includes(mode);
      assert.equal(stand.fetchedAt, known ? "2026-10-15T12:00:00.000Z" : null, mode);
      assert.equal(stand.fetchAgeMs, known ? 0 : null, mode);
    });
  }
});

async function transientFetch(remoteArgs) {
  const root = mkdtempSync(join(tmpdir(), "roadmap-transient-")), cwd = process.cwd();
  const remote = join(root, "remote.git"), seed = join(root, "seed"), client = join(root, "client");
  const clock = "2026-10-21T16:00:00Z";
  const env = { ...cleanEnv(), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null" };
  const git = (dir, args, date = clock) => {
    const r = makeRunner({ env: { ...env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } })("git", ["-C", dir, ...args]);
    assert.equal(r.code, 0, r.stderr);
    return r.stdout.trim();
  };
  try {
    for (const dir of [remote, seed, client]) mkdirSync(dir);
    git(remote, ["init", "--bare", "-q"]); git(seed, ["init", "-q", "-b", "main"]);
    mkdirSync(join(seed, "docs")); writeFileSync(join(seed, "docs/PLAN.md"), table("A"));
    const commit = () => {
      git(seed, ["add", "."]);
      git(seed, ["-c", "user.name=Fixture", "-c", "user.email=fixture@users.noreply.github.com", "commit", "-q", "-m", "plan"]);
      return git(seed, ["rev-parse", "HEAD"]);
    };
    const a = commit();
    git(seed, ["branch", "other"]); git(seed, ["remote", "add", "origin", remote]);
    git(seed, ["push", "-q", "origin", "main", "other"]);
    git(client, ["init", "-q"]); git(client, ["remote", "add", "origin", remote]);
    git(client, ["fetch", "-q", "origin", "main"], "2026-10-20T12:00:00Z");
    writeFileSync(join(seed, "docs/PLAN.md"), table("B"));
    const b = commit(); git(seed, ["push", "-q", "origin", "main"]);
    git(client, ["fetch", "-q", "--no-write-fetch-head", "origin", "main"], "2026-10-21T15:00:00Z");
    assert.equal(git(client, ["config", "--get-all", "remote.origin.fetch"]), "+refs/heads/*:refs/remotes/origin/*");
    git(client, ["-c", "remote.origin.fetch=^refs/heads/main", "-c", "remote.origin.fetch=+refs/heads/other:refs/remotes/origin/main", "fetch", "-q", "--append", ...remoteArgs]);
    assert.equal(git(client, ["config", "--get-all", "remote.origin.fetch"]), "+refs/heads/*:refs/remotes/origin/*");
    assert.notEqual(a, b);
    assert.equal(git(client, ["ls-remote", "origin", "refs/heads/main"]).split("\t")[0], b);
    assert.equal(git(client, ["rev-parse", "origin/main"]), a);
    const fetchHead = readFileSync(join(client, ".git/FETCH_HEAD"), "utf8");
    assert.ok(fetchHead.includes(`${a}\t\tbranch 'main' of `));
    assert.ok(!fetchHead.includes(`${b}\t\tbranch 'main' of `));
    assert.equal(git(client, ["reflog", "show", "-1", "--format=%gs", "refs/remotes/origin/main"]), `fetch -q --append${remoteArgs.length ? " origin" : ""}: forced-update`);
    const real = makeRunner({ env }), run = (cmd, args) => cmd === "gh" ? { code: 0, stdout: "[]" } : real(cmd, args);
    let out = "", errors = ""; process.chdir(client);
    const code = await main(["--stdout"], { out: s => { out += s; }, err: s => { errors += s; } }, { run, now: clock });
    const { stand } = JSON.parse(out);
    assert.equal(code, 0, errors); assert.equal(errors, ""); assert.equal(stand.mainSha, a);
    assert.equal(stand.fetchedAt, null, JSON.stringify({ remoteMain: b, localOriginMain: a, code, errors, stand }));
    assert.equal(stand.fetchAgeMs, null);
  } finally { process.chdir(cwd); rmSync(root, { recursive: true, force: true }); }
}

test("transient origin fetch mapping cannot date historical main as fresh", async () => {
  await transientFetch(["origin"]);
});

test("transient bare fetch mapping cannot date historical main as fresh", async () => {
  await transientFetch([]);
});

test("fetch evidence failures stay unknown with one diagnostic and no payload", async () => {
  const fake = (cmd, args) => cmd === "git" && args[0] === "remote" ? { code: 124, stdout: "private.invalid" } : undefined;
  await inRepo({ fake, args: ["--stdout"] }, ({ code, out, errors }) => {
    assert.equal(code, 0);
    assert.equal(JSON.parse(out).stand.fetchedAt, null);
    assert.equal(errors.split("\n").filter(Boolean).length, 1);
    assert.match(errors, /^roadmap: fetch evidence unavailable.*exit 124/);
    assert.ok(!errors.includes("private.invalid"));
  });
});

test("fetch evidence normalizes git suffixes on both remote descriptions", async () => {
  for (const suffix of ["", ".git", ".git/"]) {
    const setup = (dir, git) => {
      git("branch", "-M", "main"); git("remote", "add", "origin", ".git"); git("fetch", "-q", "origin", "main");
      const file = join(dir, ".git/FETCH_HEAD");
      writeFileSync(file, readFileSync(file, "utf8").replace(/of .*\n$/, `of ${suffix}\n`));
      utimesSync(file, new Date(now), new Date(now));
    };
    await inRepo({ setup, args: ["--stdout"] }, ({ code, out }) => {
      assert.equal(code, 0);
      assert.equal(JSON.parse(out).stand.fetchedAt, "2026-10-15T12:00:00.000Z", suffix);
    });
  }
});

test("the real plan checker omission contract reaches the page", async () => {
  const fake = (cmd, args) => {
    if (cmd === "gh" && args.includes("300")) return { code: 1, stdout: "" };
    if (cmd === "git" && args.includes("--format=%cI")) return { code: 0, stdout: now };
  };
  await inRepo({ fake, withPlanCheck: true, args: ["--page", "--stdout"] }, ({ code, out, errors }) => {
    assert.equal(code, 0, errors);
    assert.match(out, /GitHub-Abfrage fehlgeschlagen; PRs und Planalter-Abgleich nicht geprüft/);
    assert.match(out, /Laufende Jobs \(kein --events\)/);
    assert.doesNotMatch(out, /Prüfumfang unbekannt|das Ergebnis der Plan-Prüfung wurde nicht übergeben/);
  });
});
