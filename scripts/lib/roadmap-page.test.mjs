import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderRoadmap } from "./roadmap-page.mjs";
import { buildRoadmap } from "./roadmap-data.mjs";

const EVIL = `</script><img src=x onerror=alert(1)>&amp;"'`;
const pkg = (id, extra = {}) => ({ id, title: `Goal of ${id}`, owner: "Worker", deps: [], direction: "Alpha", provisional: false, version: "v7.1.0", state: null, planStatus: "laut PLAN: Geplant", pr: null, open: false, finished: false, parked: false, blocker: false, seam: false, mergedAt: null, level: 0, source: { file: "docs/PLAN.md", line: 42 }, ...extra });
const data = (extra = {}) => ({ stand: { generatedAt: "2031-02-03T04:05:06.000Z", mainSha: "feedbee" }, head: { nextVersion: "v7.1.0", open: 31, yourSteps: 22, blockers: 13 }, haengt: [], directions: [], packages: [], ...extra });
const render = (d, o = {}) => renderRoadmap(d, { tokensCss: ":root{--g-ink:#000}", stateCss: ".g-st{}", ...o });
const h2 = (html) => [...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1]);
const part = (html, title) => html.split(new RegExp(`<h2[^>]*>${title}</h2>`))[1].split("<h2")[0];
const top = (html) => html.split("<h2")[0];
const haengt = (n) => ({ id: `H-${n}`, what: `What ${n}`, who: "du", change: `Change ${n}`, when: `When ${n}`, where: `PLAN:${n}`, blocker: false });

test("hostile strings from every input stay inert text", () => {
  const e = EVIL, line = EVIL;
  const html = render(data({ stand: { generatedAt: e, mainSha: e }, haengt: [{ id: e, what: e, who: e, change: e, when: e, where: e, blocker: true }],
    directions: [{ name: e, now: [e], next: [], later: [], forecast: e }],
    packages: [pkg(e, { title: e, direction: e, owner: e, version: e, state: e, deps: [e], source: { file: e, line } })] }),
  { releases: [{ tagName: e, publishedAt: e }], findings: [{ kind: e, id: e, detail: e, file: e, line, pr: e }], changes: [{ date: e, text: e }] });
  assert.equal(html.match(/<script/g).length, 1);
  assert.ok(!html.includes(e) && !html.includes("<img"));
  assert.ok(html.includes("&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;&amp;amp;"));
});

test("sections follow the reading order and directions list Jetzt before Später", () => {
  const html = render(data({ directions: [{ name: "Alpha", now: [], next: [], later: [], forecast: "zu wenig Daten" }] }));
  assert.deepEqual(h2(html), ["Hängt", "Zeitleiste", "Richtungen", "Abhängigkeiten", "Plan-Mängel", "Plan-Änderungen"]);
  assert.equal(html.match(/<h1[^>]*>Roadmap<\/h1>/g).length, 1);
  const r = part(html, "Richtungen");
  assert.ok(r.indexOf("Jetzt") < r.indexOf("Als Nächstes") && r.indexOf("Als Nächstes") < r.indexOf("Später"));
});

test("head shows the supplied stand and exactly four supplied numbers", () => {
  const head = top(render(data({ packages: [pkg("A-1")] })));
  for (const s of ["2031-02-03T04:05:06.000Z", "feedbee", "v7.1.0", ">31<", ">22<", ">13<"]) assert.ok(head.includes(s), s);
  assert.equal(head.match(/<dd>/g).length, 4);
  for (const s of ["a5f8c538", "2026-10-15", "v2.0.0"]) assert.ok(!head.includes(s), s);
});

test("missing facts read Unbekannt instead of a number or an invented date", () => {
  const html = render(data({ stand: {}, head: {}, packages: [pkg("A-1")] }));
  assert.ok(top(html).match(/Unbekannt/g).length >= 6);
  assert.ok(!/1970|NaN|undefined|null/.test(html));
});

test("an empty plan and a stale stand and absent auxiliary sources do not pass as proof", () => {
  const empty = render(data({ packages: [] }));
  assert.match(top(empty), /leer oder nicht lesbar/);
  for (const s of [">31<", ">22<", ">13<"]) assert.ok(!top(empty).includes(s), s);
  assert.equal(empty.match(/noch nicht verbunden/g).length, 3);
  const full = data({ packages: [pkg("A-1")] });
  assert.match(render(full, { now: "2031-02-04T04:05:07Z" }), /veraltet/);
  assert.doesNotMatch(render(full, { now: "2031-02-03T05:05:06Z" }), /veraltet/);
  assert.doesNotMatch(render(full, { findings: [], changes: [], releases: [] }), /noch nicht verbunden/);
});

test("Hängt shows the five fields without action controls and keeps every row", () => {
  const html = part(render(data({ haengt: [1, 2, 3, 4, 5].map(haengt) })), "Hängt");
  for (const s of ["H-1", "What 3", "Change 4", "When 5", "PLAN:5", "weitere 2 anzeigen"]) assert.ok(html.includes(s), s);
  assert.doesNotMatch(html, /<button|<form|<input/);
  assert.match(part(render(data()), "Hängt"), /Gerade nichts/);
});

test("directions keep every lane and status and show only the supplied forecast", () => {
  const d = data({ packages: [pkg("A-1"), pkg("A-2"), pkg("A-3"), pkg("A-4", { parked: true }), pkg("A-5", { finished: true, state: "Erledigt" })],
    directions: [{ name: "Alpha", now: ["A-1"], next: ["A-2"], later: ["A-3", "A-4"], forecast: { fromDays: 77, toDays: 99, label: "Prognose, keine Zusage", merged: 12 } },
      { name: "Beta", now: [], next: [], later: [], forecast: "zu wenig Daten" }] });
  const html = render(d), r = part(html, "Richtungen");
  for (const s of ["A-1", "A-2", "A-3", "A-4", "Verschoben", "A-5", "erledigt", "77–99 Tage", "Prognose, keine Zusage", "zu wenig Daten", "Gerade nichts", "1 Richtung ruht"]) assert.ok(r.includes(s), s);
  assert.ok(!top(html).includes("data-dir"));
});

test("package details name source line and PR and unresolved dependencies with g-st state forms", () => {
  const html = render(data({ packages: [pkg("A-1", { source: { file: "docs/PLAN.md", line: 1234 }, pr: 77, deps: ["A-2", "GONE-9"], state: "Fehler" }), pkg("A-2", { planStatus: "laut PLAN: In Arbeit" })] }));
  for (const s of ["docs/PLAN.md:1234", "#77", "GONE-9", "nicht im Plan", "g-st--bad", "Fehler", "g-st--unknown"]) assert.ok(html.includes(s), s);
});

test("page is standalone without external references or animation under a strict policy", () => {
  const html = render(data({ packages: [pkg("A-1")] }));
  assert.doesNotMatch(html, /https?:|\/\/[a-z]|<link|<img|<iframe|src=|@import|url\(|fetch\(|XMLHttpRequest|sendBeacon|@keyframes|animation:|infinite/i);
  for (const s of ["lang=\"de\"", "name=\"viewport\"", "default-src 'none'", ":focus-visible", "prefers-reduced-motion"]) assert.ok(html.includes(s), s);
});

test("inputs stay unmodified and css cannot close the style element", () => {
  const freeze = (o) => { Object.values(o).forEach((v) => typeof v === "object" && v && freeze(v)); return Object.freeze(o); };
  const d = freeze(data({ futureField: { x: 1 }, packages: [pkg("A-1", { unresolvedDeps: ["X-1"] })] }));
  assert.equal(renderRoadmap(d, { tokensCss: "x{}</style><b id=pwn>" }).match(/<\/style/g).length, 1);
  const real = renderRoadmap(d);
  assert.ok(real.includes("--g-ground") && real.includes(".g-st--bad"));
});

test("a missing or unusable options.now still warns about an old stand", () => {
  const plan = "## Zukunft\n\n| ID | Ziel | Status | Owner |\n|---|---|---|---|\n| APP-1 | Search | Geplant | Worker |\n";
  const old = buildRoadmap({ plan, prs: [], releases: [], now: "2000-01-01T00:00:00Z", mainSha: "feedbee" });
  assert.match(top(render(old)), /veraltet/);
  assert.match(top(render(old, { now: "not a date" })), /veraltet/);
  assert.doesNotMatch(top(render(data({ stand: { generatedAt: new Date().toISOString(), mainSha: "feedbee" }, packages: [pkg("A-1")] }))), /veraltet/);
});

test("the direction filter opens overflow hits and counts only the cards that match", () => {
  const packages = [...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => pkg(`A-${n}`)), pkg("B-1", { direction: "Beta" })];
  const html = render(data({ packages, directions: ["Alpha", "Beta"].map((name) => ({ name, now: [], next: [], later: [], forecast: "zu wenig Daten" })) }));
  const { window } = new JSDOM(html, { runScripts: "dangerously" });
  const doc = window.document, deps = doc.getElementById("abhaengigkeiten"), pick = (value) => { doc.getElementById("dir").value = value; doc.getElementById("dir").dispatchEvent(new window.Event("change")); };
  const shown = (el) => { for (let n = el; n && n !== deps; n = n.parentElement) if (n.hidden || (n.tagName === "DETAILS" && !n.open)) return false; return true; };
  const cards = (dir) => [...deps.querySelectorAll(`li[data-dir="${dir}"]`)].filter(shown);
  const summary = () => deps.querySelector("details:not(.card) > summary");
  assert.equal(summary().textContent, "weitere 2 anzeigen");
  pick("Beta");
  assert.equal(cards("Beta").length, 1);
  assert.equal(cards("Alpha").length, 0);
  assert.ok(!summary().closest("li").hidden && summary().textContent === "weitere 1 anzeigen");
  pick("");
  assert.equal(cards("Alpha").length, 7);
  assert.equal(summary().textContent, "weitere 2 anzeigen");
  window.close();
});

test("real buildRoadmap output renders with its owner and package facts", () => {
  const plan = "## Zukunft\n\n| ID | Ziel | Status | Owner |\n|---|---|---|---|\n| APP-1 | Search | Geplant | Worker |\n| APP-2 | Index | Geplant | Nutzer |\n";
  const html = render(buildRoadmap({ plan, prs: [], releases: [], now: "2031-02-03T04:05:06Z", mainSha: "feedbee" }));
  assert.ok(part(html, "Hängt").includes("APP-2") && html.includes("APP-1") && html.includes("feedbee"));
});
