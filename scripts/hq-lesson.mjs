#!/usr/bin/env node
// CLI for the HQ known-error memory (docs/dev-hq/lessons.json).
//   npm run hq:lesson -- search "<query>"
//   npm run hq:lesson -- add --symptom "..." --cause "..." --fix "..." [--tags a,b] [--source path]
//   npm run hq:lesson -- hit <id>            (the symptom showed up again)
//   npm run hq:lesson -- worked <id> --run <runId> | failed <id> --run <runId>
//   npm run hq:lesson -- refine <id> --fix "..." [--cause "..."] [--note "..."] [--tags a,b]
//   npm run hq:lesson -- brief "<query>" [--limit n]   (markdown for a prompt)
//   npm run hq:lesson -- stats
import { join } from "node:path";
import { addLesson, feedbackLesson, lessonBadges, lessonBrief, lessonStats, readLessonsFile, refineLesson, searchLessons, touchLesson, writeLessonsFile } from "./lib/hq-lessons.mjs";

const root = process.cwd();
const file = process.env.HQ_LESSONS_FILE || join(root, "docs", "dev-hq", "lessons.json");
const [command = "search", ...rest] = process.argv.slice(2);

function flag(name) {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
}

const lessons = readLessonsFile(file);

if (command === "search") {
  const query = rest.filter((a) => !a.startsWith("--")).join(" ");
  const hits = searchLessons(lessons, query, Number(flag("limit") || 10));
  if (!hits.length) {
    console.log(`no lesson matches "${query}" — if you solve this, add it: npm run hq:lesson -- add --symptom ... --cause ... --fix ...`);
    process.exit(0);
  }
  for (const l of hits) {
    const b = lessonBadges(l);
    console.log(`${l.id}  ${b.label}${b.confidence === null ? "" : ` ${b.confidence}% worked`}  seen ${l.hits}×  [${(l.tags || []).join(", ")}]`);
    console.log(`  symptom: ${l.symptom}`);
    console.log(`  cause:   ${l.cause}`);
    console.log(`  fix:     ${l.fix}`);
    if (l.source) console.log(`  source:  ${l.source}`);
  }
} else if (command === "add") {
  try {
    const result = addLesson(lessons, {
      symptom: flag("symptom"), cause: flag("cause"), fix: flag("fix"),
      tags: (flag("tags") || "").split(",").map((t) => t.trim()).filter(Boolean),
      source: flag("source"),
    });
    writeLessonsFile(file, result.lessons);
    console.log(`${result.merged ? "merged into" : "added"} ${result.lesson.id} (seen ${result.lesson.hits}×) → ${file}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
} else if (command === "hit") {
  const id = rest[0];
  if (!lessons.some((l) => l.id === id)) {
    console.error(`unknown lesson ${id}`);
    process.exit(1);
  }
  writeLessonsFile(file, touchLesson(lessons, id));
  console.log(`${id} seen again`);
} else if (command === "worked" || command === "failed") {
  const id = rest[0];
  if (!lessons.some((l) => l.id === id)) {
    console.error(`unknown lesson ${id}`);
    process.exit(1);
  }
  const next = feedbackLesson(lessons, id, command, undefined, flag("run"));
  writeLessonsFile(file, next);
  const b = lessonBadges(next.find((l) => l.id === id));
  console.log(`${id}: fix ${command} — now ${b.label}${b.confidence === null ? "" : `, ${b.confidence}% worked`}`);
} else if (command === "refine") {
  const id = rest[0];
  if (!lessons.some((l) => l.id === id)) {
    console.error(`unknown lesson ${id}`);
    process.exit(1);
  }
  try {
    const next = refineLesson(lessons, id, { fix: flag("fix"), cause: flag("cause"), note: flag("note"), tags: flag("tags") ? flag("tags").split(",").map((t) => t.trim()).filter(Boolean) : undefined });
    writeLessonsFile(file, next);
    console.log(`${id} refined (previous fix kept in history)`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
} else if (command === "brief") {
  const query = rest.filter((a) => !a.startsWith("--") && a !== flag("limit")).join(" ");
  process.stdout.write(lessonBrief(lessons, query, Number(flag("limit") || 5)));
} else if (command === "stats") {
  console.log(JSON.stringify(lessonStats(lessons), null, 2));
} else {
  console.error("usage: hq-lesson search <query> | add --symptom .. --cause .. --fix .. [--tags a,b] [--source p] | hit <id> | worked <id> | failed <id> | refine <id> --fix .. | brief <query> | stats");
  process.exit(2);
}
