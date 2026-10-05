// scripts/lib/hq-honest.test.mjs — V16-07 "HQ ehrlich machen": four honesty fixes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { commitsPerDay, remainingEstimate } from "./hq-stats.mjs";
import { parseMilestones } from "./hq-parse.mjs";
import * as liveLib from "./hq-live-lib.mjs";

const { readLimited, MAX_BODY_BYTES } = liveLib;

test("remainingEstimate shows no ETA when the snapshot is unknown", () => {
  const unknown = remainingEstimate(null);
  assert.equal(unknown.hours, null);
  assert.equal(unknown.label, "unknown");
  assert.match(unknown.basis, /no specification snapshot/);
});

test("remainingEstimate invents no minimum for an empty backlog", () => {
  assert.equal(remainingEstimate(0).hours, 0);
  assert.equal(remainingEstimate(0).label, "nothing remaining");
  assert.equal(remainingEstimate(3).hours, 12);
});

test("parseMilestones reports a Stand cell opening with blockiert as blocked", () => {
  const plan = [
    "### M9 — Test",
    "",
    "| ID | Paket | Gr. | Lane | Stand |",
    "|---|---|---|---|---|",
    "| B-1 | stuck | S | other | blockiert: wartet auf B-0 |",
    "| B-2 | stuck after merge | S | other | ✓ #1, blockiert: Rest wartet |",
    "| B-3 | not started | S | other | offen |",
  ].join("\n");
  const state = Object.fromEntries(parseMilestones(plan)[0].packages.map((p) => [p.id, p.state]));
  assert.equal(state["B-1"], "blocked");
  assert.equal(state["B-2"], "in_progress", "a merged sub-part with a blocked rest is in progress, like \"✓ #1, offen\"");
  assert.equal(state["B-3"], "open");
});

test("dev HQ page renders the blocked package state", () => {
  const js = readFileSync("docs/dev-hq/hq.js", "utf8");
  assert.match(js, /blocked:\s*\["blocked", "blocked"\]/);
  assert.match(readFileSync("docs/dev-hq/hq.css", "utf8"), /\.package-state\.blocked/);
});

test("commitsPerDay buckets commit epochs by UTC day instead of the author zone", () => {
  // 2026-10-05T23:30:00Z: a +02:00 author sees 2026-10-06 in `--date=short`.
  const epoch = Date.UTC(2026, 9, 5, 23, 30) / 1000;
  const series = commitsPerDay(`${epoch}\n`, 2, new Date("2026-10-05T12:00:00Z"));
  assert.deepEqual(series, [{ day: "2026-10-04", commits: 0 }, { day: "2026-10-05", commits: 1 }]);
  assert.doesNotMatch(readFileSync("scripts/hq-live.mjs", "utf8"), /--date=short/);
});

test("readLimited accepts a body within the limit", async () => {
  const req = new PassThrough();
  const pending = readLimited(req, 8);
  req.end("{\"a\":1}");
  assert.equal((await pending).toString("utf8"), "{\"a\":1}");
});

test("readLimited rejects an oversized chunked body with hq_body_too_large", async () => {
  const req = new PassThrough();
  const pending = readLimited(req, 8);
  req.write("12345");
  req.end("67890");
  await assert.rejects(pending, { code: "hq_body_too_large" });
});

/// Every module reachable from the live server's imports. The dispatcher hands the raw
/// request to some of them (studioRoute), so a body reader there is as reachable as one
/// in hq-live.mjs itself.
function routedModules(entry = "scripts/hq-live.mjs") {
  const found = new Map();
  const visit = (file) => {
    if (found.has(file)) return;
    const text = readFileSync(file, "utf8");
    found.set(file, text);
    for (const [, spec] of text.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+\.mjs)["']/g)) {
      visit(posix.normalize(posix.join(posix.dirname(file), spec)));
    }
  };
  visit(entry);
  return found;
}

test("the live server answers 413 and bounds every body reader", () => {
  assert.ok(MAX_BODY_BYTES > 0 && MAX_BODY_BYTES <= 4 * 1024 * 1024);
  const source = readFileSync("scripts/hq-live.mjs", "utf8");
  assert.doesNotMatch(source, /req\.on\("data"/, "raw unbounded body readers must go through readLimited");
  assert.match(source, /413/);
});

test("every routed module reads request bodies only through readLimited", () => {
  const modules = routedModules();
  assert.ok(modules.has("scripts/lib/hq-studio.mjs"), "the dispatcher routes into hq-studio.mjs; the guard must see it");
  for (const [file, text] of modules) {
    if (file === "scripts/lib/hq-live-lib.mjs") continue; // defines readLimited
    // `reply` is the runtime's response (size-capped separately), not a request body.
    assert.doesNotMatch(text, /(?<!\breply)\.on\(\s*["']data["']/, `${file}: raw body reader, use readLimited`);
    assert.doesNotMatch(text, /for\s+await\s*\(/, `${file}: stream iteration reads an unbounded body, use readLimited`);
  }
});

test("bodyErrorReply separates an oversized body from malformed JSON and a dropped connection", async () => {
  const tooLarge = Object.assign(new Error("request body exceeds 8 bytes"), { code: "hq_body_too_large" });
  assert.deepEqual(liveLib.bodyErrorReply(tooLarge), { status: 413, body: { error: tooLarge.message, code: "hq_body_too_large" } });
  assert.deepEqual(liveLib.bodyErrorReply(new SyntaxError("Unexpected token")), { status: 400, body: { error: "invalid JSON body" } });
  const req = new PassThrough();
  const pending = readLimited(req, 8);
  req.destroy(Object.assign(new Error("aborted"), { code: "ECONNRESET" }));
  await assert.rejects(pending, (error) => liveLib.bodyErrorReply(error) === null);
});

test("analysisProgress reports unknown active specs as null instead of an invented 0", () => {
  assert.equal(liveLib.analysisProgress({}).activeSpecs, null);
  assert.equal(liveLib.analysisProgress({ specs: [] }).activeSpecs, 0);
  assert.equal(liveLib.analysisProgress({ specs: [{ startable: true }, { startable: false }, {}] }).activeSpecs, 2);
  assert.equal(remainingEstimate(liveLib.analysisProgress({}).activeSpecs).label, "unknown");
});
