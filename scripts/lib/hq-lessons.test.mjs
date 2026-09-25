// scripts/lib/hq-lessons.test.mjs — known-error memory contracts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  addLesson, lessonStats, readLessonsFile, searchLessons, tokenize, touchLesson, validateLesson, writeLessonsFile,
} from "./hq-lessons.mjs";

const gdk = { symptom: "cargo check fails: Package gdk-3.0 was not found", cause: "GTK dev headers missing on the Linux runner", fix: "apt-get install libgtk-3-dev libwebkit2gtk-4.1-dev", tags: ["cargo", "linux"] };
const pw = { symptom: "browserType.launch: Executable doesn't exist at /opt/pw-browsers/chromium_headless_shell", cause: "npm playwright pins a different chromium build than the preinstalled one", fix: "HQ_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:hq:visual", tags: ["playwright", "tests"] };

test("validateLesson demands symptom, cause and fix", () => {
  assert.equal(validateLesson(gdk), null);
  assert.match(validateLesson({ symptom: "x", cause: gdk.cause, fix: gdk.fix }), /symptom/);
  assert.match(validateLesson({ ...gdk, tags: "cargo" }), /tags/);
});

test("addLesson assigns a stable id and merges an identical symptom+cause instead of duplicating", () => {
  const first = addLesson([], gdk, "2026-09-08T00:00:00Z");
  assert.match(first.lesson.id, /^L-[0-9a-f]{10}$/);
  assert.equal(first.lesson.hits, 1);
  const again = addLesson(first.lessons, { ...gdk, tags: ["ubuntu"] }, "2026-09-09T00:00:00Z");
  assert.equal(again.merged, true);
  assert.equal(again.lessons.length, 1);
  assert.equal(again.lesson.hits, 2);
  assert.deepEqual(again.lesson.tags, ["cargo", "linux", "ubuntu"]);
  assert.equal(again.lesson.lastSeen, "2026-09-09T00:00:00Z");
});

test("searchLessons ranks by symptom and tag hits; empty query lists all", () => {
  const { lessons } = addLesson(addLesson([], gdk).lessons, pw);
  const hits = searchLessons(lessons, "Executable doesn't exist chromium");
  assert.equal(hits[0].symptom, pw.symptom);
  assert.equal(hits.length, 1, "gdk lesson shares no token with the query");
  assert.equal(searchLessons(lessons, "cargo")[0].symptom, gdk.symptom, "tag match");
  assert.equal(searchLessons(lessons, "").length, 2);
});

test("touchLesson counts a repeat and lessonStats aggregates tags", () => {
  const { lessons, lesson } = addLesson([], gdk);
  const touched = touchLesson(lessons, lesson.id, "2026-09-10T00:00:00Z");
  assert.equal(touched[0].hits, 2);
  assert.equal(touchLesson(lessons, "L-nope").length, 1);
  const stats = lessonStats(addLesson(touched, pw).lessons);
  assert.equal(stats.count, 2);
  assert.equal(stats.hits, 3);
  assert.deepEqual(stats.tags[0], { tag: "cargo", count: 1 });
});

test("lessons file round-trips and tolerates a missing or broken file", () => {
  const dir = mkdtempSync(join(tmpdir(), "hq-lessons-"));
  try {
    const path = join(dir, "lessons.json");
    assert.deepEqual(readLessonsFile(path), []);
    writeLessonsFile(path, addLesson([], gdk).lessons);
    assert.equal(readLessonsFile(path)[0].fix, gdk.fix);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).schema, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tokenize drops stop words and keeps paths and error codes", () => {
  assert.deepEqual(tokenize("Package gdk-3.0 was not found in the path"), ["package", "gdk-3.0", "was", "not", "found", "path"]);
});

// --- learning over time -------------------------------------------------
import { feedbackLesson, refineLesson, relatedLessons, lessonBrief, lessonBadges, matchSignals, highlightTerms } from "./hq-lessons.mjs";

test("feedbackLesson records whether the fix helped and yields a confidence", () => {
  const { lessons, lesson } = addLesson([], gdk, "2026-09-01T00:00:00Z");
  let next = feedbackLesson(lessons, lesson.id, "worked", "2026-09-02T00:00:00Z", "fixture-1");
  next = feedbackLesson(next, lesson.id, "worked", "2026-09-03T00:00:00Z", "fixture-2");
  next = feedbackLesson(next, lesson.id, "failed", "2026-09-04T00:00:00Z", "fixture-3");
  const l = next[0];
  assert.equal(l.worked, 2);
  assert.equal(l.failed, 1);
  assert.equal(l.lastSeen, "2026-09-04T00:00:00Z");
  assert.equal(l.hits, 4, "each feedback is also a sighting");
  const badges = lessonBadges(l, new Date("2026-09-05T00:00:00Z"));
  assert.equal(badges.confidence, 67);
  assert.throws(() => feedbackLesson(next, lesson.id, "maybe"), /worked|failed/);
});

test("refineLesson keeps the old fix in history and updates the current one", () => {
  const { lessons, lesson } = addLesson([], gdk, "2026-09-01T00:00:00Z");
  const next = refineLesson(lessons, lesson.id, { fix: "apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev libsoup-3.0-dev", note: "soup was missing too" }, "2026-09-06T00:00:00Z");
  assert.match(next[0].fix, /libsoup/);
  assert.equal(next[0].history.length, 1);
  assert.equal(next[0].history[0].fix, gdk.fix);
  assert.equal(next[0].history[0].note, "soup was missing too");
  assert.throws(() => refineLesson(lessons, lesson.id, { fix: "x" }), /fix/);
});

test("lessonBadges: proven after repeated success, stale when old and single, fresh otherwise", () => {
  const now = new Date("2026-12-31T00:00:00Z");
  assert.equal(lessonBadges({ hits: 3, worked: 2, failed: 0, lastSeen: "2026-12-01T00:00:00Z" }, now).label, "proven");
  assert.equal(lessonBadges({ hits: 1, worked: 0, failed: 0, lastSeen: "2026-08-01T00:00:00Z" }, now).label, "stale");
  assert.equal(lessonBadges({ hits: 1, worked: 0, failed: 2, lastSeen: "2026-12-30T00:00:00Z" }, now).label, "disputed");
  assert.equal(lessonBadges({ hits: 1, worked: 0, failed: 0, lastSeen: "2026-12-30T00:00:00Z" }, now).label, "new");
});

test("relatedLessons finds neighbours by shared tags and symptom tokens, never itself", () => {
  const cargoMem = { symptom: "cargo build aborts with 0xc000012d / mmap errors under load", cause: "memory pressure", fix: "CARGO_BUILD_JOBS=2", tags: ["cargo", "windows"] };
  let list = addLesson([], gdk).lessons;
  list = addLesson(list, pw).lessons;
  list = addLesson(list, cargoMem).lessons;
  const related = relatedLessons(list, list[0].id, 3);
  assert.equal(related[0].symptom, cargoMem.symptom, "shares the cargo tag");
  assert.ok(!related.some((r) => r.id === list[0].id));
});

test("matchSignals maps live error signals to known lessons, empty when nothing matches", () => {
  const list = addLesson(addLesson([], gdk).lessons, pw).lessons;
  const matches = matchSignals(list, ["tests failed: Executable doesn't exist chromium", "waiting for input"]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].signal, "tests failed: Executable doesn't exist chromium");
  assert.equal(matches[0].lesson.symptom, pw.symptom);
  assert.deepEqual(matchSignals(list, ["unrelated", ""]), []);
});

test("lessonBrief renders a compact markdown block for prompts", () => {
  const list = addLesson([], gdk).lessons;
  const md = lessonBrief(list, "gdk", 5);
  assert.match(md, /^## Known errors/m);
  assert.match(md, /\*\*Symptom:\*\* cargo check fails/);
  assert.match(md, /\*\*Fix:\*\* apt-get/);
  assert.match(md, /L-[0-9a-f]{10}/);
  assert.match(lessonBrief([], "nothing", 5), /no known lesson/i);
});

test("highlightTerms wraps query tokens in <mark> after escaping", () => {
  assert.equal(highlightTerms("gdk-3.0 <was> not found", "gdk not"), "<mark>gdk-3.0</mark> &lt;was&gt; <mark>not</mark> found");
});
