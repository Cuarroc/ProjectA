// scripts/lib/hq-html.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "docs/dev-hq";
const PAGES = ["index.html", "proof.html", "map.html", "next.html", "sources.html", "lessons.html"];
const FORBIDDEN = ["Work", "Attention", "Agents", "Review", "Insights", "Settings"];

test("six pages exist with HQ nav labels only", () => {
  for (const page of PAGES) {
    const html = readFileSync(join(DIR, page), "utf8");
    assert.match(html, /<nav[^>]*class="hq-nav"/);
    assert.match(html, />Now</);
    assert.match(html, />Proof</);
    assert.match(html, />Map</);
    assert.match(html, />Next</);
    assert.match(html, />Sources</);
    assert.match(html, />Lessons</);
    const nav = html.slice(html.indexOf("hq-nav"), html.indexOf("</nav>"));
    for (const word of FORBIDDEN) {
      assert.equal(nav.includes(word), false, `${page} nav contains ${word}`);
    }
    assert.match(html, /src="\.\/data\.js"/);
    assert.match(html, /src="\.\/hq\.js"/);
    assert.doesNotMatch(html, /fonts\.googleapis/);
  }
});

test("self-hosted Recursive face, no Google Fonts in CSS", () => {
  const css = readFileSync(join(DIR, "hq.css"), "utf8");
  assert.match(css, /@font-face/);
  assert.match(css, /font-family:\s*Recursive/);
  assert.match(css, /recursive-latin-wght\.woff2/);
  assert.match(css, /font-variation-settings:\s*"MONO"\s*0/);
  assert.match(css, /\.cite[\s\S]*"MONO"\s*1/);
  assert.doesNotMatch(css, /fonts\.googleapis/);
  const woff = readFileSync(join(DIR, "fonts", "recursive-latin-wght.woff2"));
  assert.ok(woff.length > 1000);
});

test("motion: DAG stroke key, reduced-motion instant", () => {
  const css = readFileSync(join(DIR, "hq.css"), "utf8");
  const js = readFileSync(join(DIR, "hq.js"), "utf8");
  assert.match(js, /hq-dag-drawn/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /animation:\s*none\s*!important/);
  assert.match(css, /@keyframes\s+hq-in/);
  assert.match(css, /@keyframes\s+hq-lock/);
  assert.match(css, /animation:\s*hq-in\s+180ms/);
  assert.match(css, /\.dag-node[\s\S]*120ms/);
});
