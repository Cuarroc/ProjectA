// Known-error memory for the Dev HQ ("lessons"): what broke, why, and the fix
// that worked. Agents query it before they start and append after they fix.
// Side-effect free except for the two file helpers, so node:test can drive it.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "is", "it", "der", "die", "das", "und", "ein", "eine", "mit", "bei", "im", "nicht", "for", "with"]);

export function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9äöüß_./:-]+/i)
    .map((t) => t.replace(/^[./:-]+|[./:-]+$/g, ""))
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/// Returns an error string or null.
export function validateLesson(lesson) {
  if (!lesson || typeof lesson !== "object") return "lesson must be an object";
  for (const key of ["symptom", "cause", "fix"]) {
    if (typeof lesson[key] !== "string" || lesson[key].trim().length < 8) {
      return `${key} is required (at least 8 characters)`;
    }
  }
  if (lesson.tags !== undefined && !Array.isArray(lesson.tags)) return "tags must be an array";
  if (lesson.source !== undefined && lesson.source !== null && typeof lesson.source !== "string") return "source must be a string";
  return null;
}

export function lessonId(lesson) {
  return "L-" + createHash("sha256").update(`${lesson.symptom}\n${lesson.cause}`).digest("hex").slice(0, 10);
}

function normalizeTags(tags) {
  return [...new Set((tags || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean))].sort();
}

/// Insert a lesson; an identical symptom+cause pair is merged (hits +1, tags
/// united) instead of duplicated. Returns { lessons, lesson, merged }.
export function addLesson(lessons, input, now = new Date().toISOString()) {
  const invalid = validateLesson(input);
  if (invalid) throw new Error(invalid);
  const list = [...(lessons || [])];
  const id = lessonId(input);
  const index = list.findIndex((l) => l.id === id);
  if (index >= 0) {
    const merged = {
      ...list[index],
      hits: (list[index].hits || 1) + 1,
      lastSeen: now,
      tags: normalizeTags([...(list[index].tags || []), ...(input.tags || [])]),
    };
    list[index] = merged;
    return { lessons: list, lesson: merged, merged: true };
  }
  const lesson = {
    id,
    createdAt: now,
    lastSeen: now,
    hits: 1,
    symptom: input.symptom.trim(),
    cause: input.cause.trim(),
    fix: input.fix.trim(),
    tags: normalizeTags(input.tags),
    ...(input.source ? { source: String(input.source).trim() } : {}),
  };
  list.push(lesson);
  return { lessons: list, lesson, merged: false };
}

/// Record that a stored lesson applied again. Unknown ids are ignored.
export function touchLesson(lessons, id, now = new Date().toISOString()) {
  return (lessons || []).map((l) => (l.id === id ? { ...l, hits: (l.hits || 1) + 1, lastSeen: now } : l));
}

/// Rank lessons against a free-text query. Symptom matches count double,
/// tag matches triple; ties break on hits then recency. Empty query → all,
/// most-hit first.
export function searchLessons(lessons, query, limit = 20) {
  const terms = tokenize(query);
  const scored = (lessons || []).map((l) => {
    if (terms.length === 0) return { lesson: l, score: 1 };
    const symptom = new Set(tokenize(l.symptom));
    const rest = new Set([...tokenize(l.cause), ...tokenize(l.fix), ...tokenize(l.source)]);
    const tags = new Set((l.tags || []).map((t) => t.toLowerCase()));
    let score = 0;
    for (const t of terms) {
      if (tags.has(t)) score += 3;
      if (symptom.has(t)) score += 2;
      else if ([...symptom].some((s) => s.includes(t) || t.includes(s))) score += 1;
      if (rest.has(t)) score += 1;
    }
    return { lesson: l, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || (b.lesson.hits || 0) - (a.lesson.hits || 0) || String(b.lesson.lastSeen).localeCompare(String(a.lesson.lastSeen)))
    .slice(0, limit)
    .map((s) => ({ ...s.lesson, score: s.score }));
}

export function lessonStats(lessons) {
  const tags = new Map();
  let hits = 0;
  for (const l of lessons || []) {
    hits += l.hits || 1;
    for (const t of l.tags || []) tags.set(t, (tags.get(t) || 0) + 1);
  }
  return {
    count: (lessons || []).length,
    hits,
    tags: [...tags.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag, count]) => ({ tag, count })),
    recent: [...(lessons || [])].sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen))).slice(0, 5).map((l) => l.id),
  };
}

export function readLessonsFile(path) {
  try {
    if (!existsSync(path)) return [];
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(parsed?.lessons) ? parsed.lessons : Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeLessonsFile(path, lessons) {
  mkdirSync(dirname(path), { recursive: true });
  const sorted = [...lessons].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id));
  writeFileSync(path, JSON.stringify({ schema: 1, lessons: sorted }, null, 2) + "\n");
}

// --- learning over time ---------------------------------------------------

/// "worked" or "failed": did the stored fix help this time? Every feedback is
/// also a sighting, so hits keeps counting how often the symptom returns.
export function feedbackLesson(lessons, id, outcome, now = new Date().toISOString(), runId) {
  if (outcome !== "worked" && outcome !== "failed") throw new Error('outcome must be "worked" or "failed"');
  if (typeof runId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(runId)) throw new Error("valid runId is required for feedback");
  return (lessons || []).map((l) => {
    if (l.id !== id) return l;
    const prior = runId && (l.feedbackRuns || []).find((entry) => entry.runId === runId);
    if (prior) {
      if (prior.outcome !== outcome) throw new Error("run already has a different outcome");
      return l;
    }
    return { ...l, hits: (l.hits || 1) + 1, lastSeen: now,
      worked: (l.worked || 0) + (outcome === "worked" ? 1 : 0), failed: (l.failed || 0) + (outcome === "failed" ? 1 : 0),
      ...(runId ? { feedbackRuns: [...(l.feedbackRuns || []), { runId, outcome, observedAt: now }] } : {}) };
  });
}

/// Replace the fix (and optionally cause/tags) while keeping the previous fix
/// in an append-only history — the memory improves, it never forgets.
export function refineLesson(lessons, id, update, now = new Date().toISOString()) {
  if (typeof update?.fix !== "string" || update.fix.trim().length < 8) throw new Error("fix is required (at least 8 characters)");
  return (lessons || []).map((l) => {
    if (l.id !== id) return l;
    const entry = { at: now, fix: l.fix, ...(l.cause !== (update.cause || l.cause) ? { cause: l.cause } : {}), ...(update.note ? { note: String(update.note).trim() } : {}) };
    return {
      ...l,
      fix: update.fix.trim(),
      cause: typeof update.cause === "string" && update.cause.trim().length >= 8 ? update.cause.trim() : l.cause,
      tags: update.tags ? normalizeTags([...(l.tags || []), ...update.tags]) : l.tags,
      lastSeen: now,
      history: [...(l.history || []), entry],
    };
  });
}

/// A label and a confidence for the UI. Confidence is the share of feedback
/// that said "worked" (null without feedback).
export function lessonBadges(lesson, now = new Date()) {
  const worked = lesson.worked || 0;
  const failed = lesson.failed || 0;
  const votes = worked + failed;
  const confidence = votes ? Math.round((worked / votes) * 100) : null;
  const ageDays = Math.floor((now.getTime() - new Date(lesson.lastSeen || lesson.createdAt || now).getTime()) / 86400000);
  let label = "new";
  if (failed > worked) label = "disputed";
  else if (worked >= 2 && confidence >= 60) label = "proven";
  else if (ageDays > 90 && (lesson.hits || 1) <= 1) label = "stale";
  else if ((lesson.hits || 1) >= 3) label = "recurring";
  return { label, confidence, ageDays, votes };
}

/// Neighbours by shared tags (weight 2) and shared symptom tokens (weight 1).
export function relatedLessons(lessons, id, limit = 3) {
  const self = (lessons || []).find((l) => l.id === id);
  if (!self) return [];
  const tags = new Set((self.tags || []).map((t) => t.toLowerCase()));
  const tokens = new Set(tokenize(self.symptom));
  return (lessons || [])
    .filter((l) => l.id !== id)
    .map((l) => {
      let score = 0;
      for (const t of l.tags || []) if (tags.has(t.toLowerCase())) score += 2;
      for (const t of tokenize(l.symptom)) if (tokens.has(t)) score += 1;
      return { lesson: l, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || (b.lesson.hits || 0) - (a.lesson.hits || 0))
    .slice(0, limit)
    .map((s) => ({ ...s.lesson, score: s.score }));
}

/// Live signals (attention reasons, failing test status, queue errors) →
/// the best known lesson for each, when the match is strong enough.
export function matchSignals(lessons, signals, minScore = 3) {
  const out = [];
  for (const signal of signals || []) {
    if (!signal || tokenize(signal).length === 0) continue;
    const [best] = searchLessons(lessons, signal, 1);
    if (best && best.score >= minScore) out.push({ signal, lesson: best });
  }
  return out;
}

/// Compact markdown an orchestrator can paste into a worker prompt.
export function lessonBrief(lessons, query, limit = 5) {
  const hits = searchLessons(lessons, query, limit);
  if (!hits.length) return `## Known errors\n\n_No known lesson matches "${query}". If you solve it, record it: npm run hq:lesson -- add …_\n`;
  const lines = ["## Known errors", "", `Matches for "${query}" from docs/dev-hq/lessons.json — apply the fix, then report back with npm run hq:lesson -- worked <id> | failed <id>.`, ""];
  for (const l of hits) {
    const b = lessonBadges(l);
    lines.push(`### ${l.id} · ${b.label}${b.confidence === null ? "" : ` · ${b.confidence}% worked`} · seen ${l.hits}×`);
    lines.push(`- **Symptom:** ${l.symptom}`);
    lines.push(`- **Cause:** ${l.cause}`);
    lines.push(`- **Fix:** ${l.fix}`);
    if (l.source) lines.push(`- **Source:** ${l.source}`);
    lines.push("");
  }
  return lines.join("\n");
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/// Escape, then wrap every query token (as a whole "word" incl. -./:) in <mark>.
export function highlightTerms(text, query) {
  const escaped = escapeHtml(text);
  const terms = tokenize(query);
  if (!terms.length) return escaped;
  const pattern = new RegExp(`(^|[^a-z0-9äöüß_./:-])((?:[a-z0-9äöüß_./:-]*)(?:${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?:[a-z0-9äöüß_./:-]*))`, "gi");
  return escaped.replace(pattern, (_m, lead, word) => `${lead}<mark>${word}</mark>`);
}
