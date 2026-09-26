# Review request W1-17: HQ parser reads the PLAN.md milestone tables

You are an independent reviewer (not the author; the author is a Claude model).
Review the COMPLETE candidate below (commit ba6248c, diff against the merge base;
the regenerated snapshot docs/dev-hq/data.js|.json is omitted, it is a generated file)
for correctness bugs, regressions, gaps against the requirements and missing tests.
Be concrete: cite file and line (or function), say what breaks and when. Rate each
finding high/medium/low. Do not restate the diff. If something is fine, say nothing
about it. Answer in English or German. READ-ONLY review: do not run commands.

## Context

Repo: ProjectA, a Tauri 2 "agentic terminal" (public GitHub repo). The dev HQ is a
static site (docs/dev-hq/*.html + hq.js) fed by a generated snapshot (data.js/.json,
written by scripts/dev-hq.mjs via scripts/lib/hq-parse.mjs). The snapshot used to
carry F0-F8 "packages" (PACKAGE_EDGES, a hard-coded DAG) that all showed as
"waiting", while docs/PLAN.md now has milestones M1-M4 with one table per milestone.

## Requirement (W1-17)

Check first whether scripts/dev/status-report.mjs (OPS-01) or another parser already
covers this (do not build twice); otherwise: the parser reads the sections
"### M1 — ..." to "### M4 — ..." and their tables (columns ID | Paket | Gr. | Lane |
Stand; Stand "✓ #NN" = done, "offen", "PR #NN", "in Arbeit" ...). Per milestone: title,
packages with a state (done/open/in_progress/pr), progress x/y. The HQ shows these
instead of the F milestones. hq.js only touched minimally. Red-first: a test against
an excerpt of the real PLAN.md structure that is red with the old parser.

Findings by the author before review: status-report.mjs does not read PLAN.md;
scripts/dev/hygiene.mjs has a private table walker that only extracts "in Arbeit"/"PR #n"
rows (not reusable as is). buildPackages/PACKAGE_EDGES stay internally because
buildNext uses them for its startable gating, but they are no longer emitted.
The DAG code in hq.js (drawDag, DAG_POS, ...) was removed; the .dag-* CSS was left in
hq.css on purpose (hq.css belongs to the HQ style package).

## Real docs/PLAN.md structure (lines 24-70 of the candidate)

```markdown
## Meilensteine

| M | Titel | Abnahme in Alltagssprache |
|---|---|---|
| M1 | Alles Laufende gelandet, App startbar | Keine offenen Paket-PRs aus M1, `main` grün. Die App startet vom aktuellen `main`, ohne dass alte Queue-Einträge Agenten losschicken; tote Einträge lassen sich gezielt verwerfen (W1-05b). |
| M2 | Überblick und Setup | Du fragst Claude „Was heißt das?“ und bekommst eine einfache Antwort. Ein Skript schreibt Status und Tagesbericht. Ein Plan, zehn Regeln, gestufte Reviews. Ein roter `main` hält die Queue an. Limits und RAM werden vor jedem Worker-Start geprüft. Backup läuft. |
| M3 | App im Alltag + Zwischenrelease v1.5.0-beta | Du installierst v1.5.0-beta über den Updater. In der installierten App gibst du drei echte kleine Aufgaben an Agenten, verfolgst sie im HQ, prüfst den Diff in der App, und der PR landet über die Queue. Das HQ ist hell und dunkel lesbar (Screenshots angesehen, auch die DF-07-Dichte). |
| M4 | Dauerbetrieb abgenommen, v1.5.0 | Du schaltest den Continuous Mode selbst ein. Ein Not-Aus stoppt alles in 10 Sekunden. Alle 27 Zeilen der Abnahmematrix haben einen Beleg oder ein Nutzer-Gate. Update-Drills sind am PC durchgespielt. Du installierst v1.5.0. |

Lane-Schlüssel: `st` store.rs + store/ · `api` api.rs · `mn` main.rs · `pa`
bin/pa.rs (diese vier sind Nahtstellen, je ein aktives Paket) · `pty` pty.rs ·
`wk` workers.rs/profiles.rs · `sup` supervisor.rs · `ci` .github/ + scripts/ci/ ·
`hqL` Legacy-HQ (hq.js, hq.css, hq-parse.mjs, hq-live.mjs) · `hqS`
docs/dev-hq/concepts/ · `fe` src/ · `fR` nahtstellenfreies Rust · `doc` Doku und
scripts/dev · `N` Nutzer/PC. Welches Modell welches Paket nimmt:
`docs/setup/providers.md`. Stand-Spalte: `✓ #n` = gemergt, sonst offener PR
oder „offen“ (Momentaufnahme; den Live-Stand liefert OPS-01).

### M1 — Alles Laufende gelandet, App startbar

| ID | Paket | Gr. | Lane | Stand |
|---|---|---|---|---|
| W2-03 | Usage-/Billing-Collectors je Adapter | M | st | ✓ #140 |
| W2-06 | Supervisor: Producer-Audit und Runtime-Notifications | M | mn + sup | ✓ #152 |
| W2-08a | Ressourcendruck- und Streaming-Enforcement | M | fR | ✓ #134 |
| W2-04f | Planungsendpunkte nur für den Koordinator | S | api | ✓ #135 |
| W2-01b | Review-Route nimmt `reviewerRunId` aus dem Credential | S | api | ✓ #124 |
| W2-01c | `approvalAuthority` in agent_access.rs angleichen | S | fR | ✓ #150 |
| W1-15c | Übrige Mutex-Stellen in pty.rs | S | pty | ✓ #137 |
| W1-23c | „-0 Tokens“-Anzeige, MSRV gemessen | S | fR | ✓ #136 |
| W1-29 | Linux-Flake im Prozessgruppen-Test | S | fR | ✓ #138 |
| W1-21c | xterm-`pageerror` beim Mount | S | fe | ✓ #151 |
| SETUP-04 | AGENTS.md: Mergify, Reviews, Build-Slots | M | doc | ✓ #132 |
| HOOK-01 | Hook-ROOT-Fix einzeln vor CI-02 (Nutzer 25.09.) | S | ci | ✓ #156 |
| W1-05b | Sichere Cancel-Regel für `dispatched`, Dedup der toten Tasks; erst st-Kind, dann api-Kind; Zahl der toten Einträge read-only nachzählen | M | st → api | ✓ #19 |
| W1-03e | `MSG_USER` erst nach bewiesener Zustellung (F-CORE-3 B.3) | S | wk | ✓ #171 |
| W1-20 | Zweites Setup reproduzieren (Node 24, `npm ci`, `dev:setup`, `dev:doctor`) | S | N | ✓ #166 |
| CI-02 | Leichter main-Push, Docs-only, Dependabot im red-first (enthält W1-19b) | S | ci | ✓ #133 |
| CI-03 | Actions-Kosten senken: CI nur bei „ready“ und in der Queue, Windows nur in Queue und Wochenlauf, Budgetstopp ab 80 % | M | ci | ✓ #149 |
| SETUP-08 | Git-/PR- und Plan-Helfer unter `scripts/dev` (08a + 08b) | M | doc | ✓ #22 |
| SEC-01 | Geheimnis-Scan (gitleaks) als precommit-Gate | S | ci | ✓ #20 |

### M2 — Überblick und Setup

| ID | Paket | Gr. | Lane | Stand |
|---|---|---|---|---|
| M2-FRAG | Frag-mich-Skill für Einsteiger-Erklärungen | S | doc | ✓ #161 |
```

## Rules to check against

- Bug claims need a test; no hidden exit codes; no secrets or personal data in the repo.
- Every escaped value that reaches innerHTML in hq.js must go through escape().
- sectionTitle() does NOT escape its arguments; callers must.
- Tests must not depend on one revision of PLAN.md or STAND.md.
- The snapshot may not be mutated by tests (HQ_SKIP_SNAPSHOT).

## Output format

Findings with ID (K1, K2, ...), severity, file:line, reasoning; then a verdict:
approve / approve with conditions / reject.

## Diff

```diff
diff --git a/docs/dev-hq/hq.css b/docs/dev-hq/hq.css
index 63a1aa0..7ee9240 100644
--- a/docs/dev-hq/hq.css
+++ b/docs/dev-hq/hq.css
@@ -1306,6 +1306,13 @@ code {
   max-width: 680px;
 }
 
+/* Milestone tables: ids and states stay on one line; only the title wraps. */
+.package-table th:first-child,
+.package-table td:first-child,
+.package-state {
+  white-space: nowrap;
+}
+
 .package-state {
   color: var(--fog);
   font-size: 10px;
diff --git a/docs/dev-hq/hq.js b/docs/dev-hq/hq.js
index c4b9fd6..14ed6ab 100644
--- a/docs/dev-hq/hq.js
+++ b/docs/dev-hq/hq.js
@@ -47,13 +47,13 @@
 
   function summary(data) {
     const specs = data.specs || [];
-    const packages = data.packages || [];
+    const packages = (data.milestones || []).flatMap((m) => m.packages);
     const findings = data.findings || [];
     return {
       specs: specs.length,
       ready: countWhere(specs, (s) => s.startable !== false),
       locked: countWhere(specs, (s) => s.startable === false),
-      active: countWhere(packages, (p) => p.current === "active"),
+      active: countWhere(packages, (p) => p.state === "in_progress" || p.state === "pr"),
       facts: countWhere(findings, (f) => f.klass === "FACT"),
       claims: countWhere(findings, (f) => f.klass === "CLAIM"),
       warnings: (data.warnings || []).length,
@@ -147,7 +147,7 @@
       live: ["Live", "Operate the fleet from the same desk your agents use."],
       now: ["Now", "The operator desk for cited development truth."],
       proof: ["Proof", "Separate what is proven from what is only claimed."],
-      map: ["Map", "See the package dependencies before choosing a lane."],
+      map: ["Map", "Where each milestone of docs/PLAN.md stands, package by package."],
       next: ["Next", "Read the ordered work without guessing at the lock."],
       sources: ["Sources", "Audit every generated claim back to its source."],
       lessons: ["Lessons", "What broke before, why, and the fix that worked — the memory every agent reads first."],
@@ -1268,149 +1268,49 @@
         ? `<p class="empty-specs">no executable specs — STAND and Status: aktiv disagree or both empty</p>`
         : specTable(data.specs)
     }
-    <a class="mini-dag-link" href="./map.html" aria-label="Open package map"><svg id="mini-dag" role="img" aria-label="Package DAG thumbnail"></svg></a>
+    ${milestoneProgress(data)}
   `;
     drawLanes(document.getElementById("lane"), data);
-    drawDag(document.getElementById("mini-dag"), data.packages, { mini: true });
   }
 
-  const DAG_POS = {
-    F0: [40, 80],
-    F1: [180, 80],
-    F4: [320, 80],
-    F5: [460, 80],
-    F8: [600, 140],
-    F2: [180, 200],
-    "F6-UI": [320, 200],
-    F3: [320, 140],
-    "F6-Attribution": [460, 200],
-    F7: [40, 200],
+  const MILESTONE_STATE = {
+    done: ["done", "done"],
+    in_progress: ["active", "in progress"],
+    pr: ["active", "PR open"],
+    open: ["waiting", "open"],
   };
 
-  function dagClass(p) {
-    if (p.current === "done") return "dag-node done";
-    if (p.current === "active") {
-      return p.lane === "serial" ? "dag-node active serial" : "dag-node active parallel";
-    }
-    return "dag-node waiting";
+  function milestoneProgress(data) {
+    const milestones = data.milestones || [];
+    if (!milestones.length) return "";
+    return `${sectionTitle("Milestones", "Progress per milestone of docs/PLAN.md.")}
+    <ul class="signal-list">
+      ${milestones.map((m) => `<li><span class="signal-mark parallel"></span><div><strong>${escape(m.id)}</strong><span>${escape(m.title)}</span></div><em>${m.done}/${m.total}</em></li>`).join("")}
+    </ul>
+    <a class="text-link" href="./map.html">Open the milestone map →</a>`;
+  }
+
+  function milestoneTable(m) {
+    const rows = m.packages
+      .map((p) => {
+        const [cls, label] = MILESTONE_STATE[p.state] || MILESTONE_STATE.open;
+        return `<tr><td class="path">${escape(p.id)}</td><td>${escape(p.title)}</td><td><span class="package-state ${cls}">${label}</span></td><td>${escape(p.lane)}</td><td class="cite">${escape(p.stand)}</td></tr>`;
+      })
+      .join("");
+    return `${sectionTitle(`${escape(m.id)} — ${escape(m.title)}`, `${m.done}/${m.total} packages done`)}
+      <div class="table-wrap"><table class="spec-table package-table">
+        <thead><tr><th scope="col">package</th><th scope="col">title</th><th scope="col">state</th><th scope="col">lane</th><th scope="col">stand</th></tr></thead>
+        <tbody>${rows}</tbody>
+      </table></div>`;
   }
 
   function renderMap(data, el) {
+    const milestones = data.milestones || [];
     el.innerHTML = `
       <p class="meta">from docs/PLAN.md · ${escape(data.generatedAt)} · ${escape(data.commit || "no git")}</p>
       ${summaryStrip(data)}
-      <figure class="dag-figure">
-        <figcaption>Package DAG · Source: docs/PLAN.md</figcaption>
-        <svg id="dag"></svg>
-      </figure>
-      <div class="legend" aria-label="Package state legend">
-        <span><i class="legend-dot done"></i>done</span>
-        <span><i class="legend-dot active"></i>active</span>
-        <span><i class="legend-dot waiting"></i>waiting</span>
-        <span class="legend-note">Dependencies and sources are listed in the table below.</span>
-      </div>
-      <div class="table-wrap package-table-wrap">
-        <table class="spec-table package-table">
-          <thead><tr><th scope="col">package</th><th scope="col">state</th><th scope="col">lane</th><th scope="col">depends on</th></tr></thead>
-          <tbody>${(data.packages || []).map((p) => `<tr><td class="path">${escape(p.id)}</td><td><span class="package-state ${escape(p.current)}">${escape(p.current)}</span></td><td>${escape(p.lane)}</td><td class="cite">${escape((p.dependsOn || []).join(" · ") || "—")}</td></tr>`).join("")}</tbody>
-        </table>
-      </div>
+      ${milestones.length ? milestones.map(milestoneTable).join("") : `<p class="empty-specs">no milestone tables found in docs/PLAN.md</p>`}
     `;
-    drawDag(document.getElementById("dag"), data.packages, { mini: false });
-    strokeMapOnce(document.getElementById("dag"));
-  }
-
-  function prefersReducedMotion() {
-    return (
-      typeof matchMedia === "function" &&
-      matchMedia("(prefers-reduced-motion: reduce)").matches
-    );
-  }
-
-  function strokeMapOnce(svg) {
-    if (!svg || prefersReducedMotion()) return;
-    try {
-      if (sessionStorage.getItem("hq-dag-drawn")) return;
-      sessionStorage.setItem("hq-dag-drawn", "1");
-    } catch (_err) {
-      return;
-    }
-    svg.classList.add("dag-stroke");
-  }
-
-  function drawDag(svg, packages, opts) {
-    if (!svg) return;
-    const mini = opts && opts.mini;
-    const NS = "http://www.w3.org/2000/svg";
-    const r = mini ? 8 : 14;
-    svg.setAttribute("viewBox", "0 0 680 260");
-    svg.setAttribute("class", mini ? "dag-svg mini" : "dag-svg");
-    svg.setAttribute("role", mini ? "img" : "group");
-    svg.setAttribute("aria-label", "Package DAG from docs/PLAN.md");
-    while (svg.firstChild) svg.removeChild(svg.firstChild);
-
-    const defs = document.createElementNS(NS, "defs");
-    const marker = document.createElementNS(NS, "marker");
-    marker.setAttribute("id", "dag-arrow");
-    marker.setAttribute("viewBox", "0 0 10 10");
-    marker.setAttribute("refX", "9");
-    marker.setAttribute("refY", "5");
-    marker.setAttribute("markerWidth", "5");
-    marker.setAttribute("markerHeight", "5");
-    marker.setAttribute("orient", "auto-start-reverse");
-    const arrow = document.createElementNS(NS, "path");
-    arrow.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
-    arrow.setAttribute("fill", "currentColor");
-    marker.appendChild(arrow);
-    defs.appendChild(marker);
-    svg.appendChild(defs);
-
-    for (const p of packages || []) {
-      const to = DAG_POS[p.id];
-      if (!to) continue;
-      for (const dep of p.dependsOn || []) {
-        const from = DAG_POS[dep];
-        if (!from) continue;
-        const line = document.createElementNS(NS, "line");
-        line.setAttribute("x1", String(from[0]));
-        line.setAttribute("y1", String(from[1]));
-        line.setAttribute("x2", String(to[0]));
-        line.setAttribute("y2", String(to[1]));
-        line.setAttribute("class", "dag-edge");
-        svg.appendChild(line);
-      }
-    }
-
-    for (const p of packages || []) {
-      const pos = DAG_POS[p.id];
-      if (!pos) continue;
-      const g = document.createElementNS(NS, "g");
-      g.setAttribute("class", dagClass(p));
-      if (!mini) {
-        g.setAttribute("tabindex", "0");
-        g.setAttribute("role", "img");
-      }
-      g.setAttribute("aria-label", `${p.id} ${p.current} package`);
-      const circle = document.createElementNS(NS, "circle");
-      circle.setAttribute("cx", String(pos[0]));
-      circle.setAttribute("cy", String(pos[1]));
-      circle.setAttribute("r", String(r));
-      g.appendChild(circle);
-      const title = document.createElementNS(NS, "title");
-      const deps = (p.dependsOn || []).join(", ");
-      title.textContent = deps
-        ? `${p.id} · ${p.lane} · ${p.source} · dependsOn ${deps}`
-        : `${p.id} · ${p.lane} · ${p.source}`;
-      g.appendChild(title);
-      const text = document.createElementNS(NS, "text");
-      text.setAttribute("x", String(pos[0]));
-      text.setAttribute("y", String(pos[1] + (mini ? 18 : 26)));
-      text.setAttribute("text-anchor", "middle");
-      text.setAttribute("class", "dag-label");
-      text.textContent = p.id;
-      g.appendChild(text);
-      svg.appendChild(g);
-    }
   }
 
   const KLASS_ORDER = ["FACT", "CLAIM", "UNPROVEN"];
diff --git a/scripts/dev-hq.mjs b/scripts/dev-hq.mjs
index 5dbecda..18b9d9f 100644
--- a/scripts/dev-hq.mjs
+++ b/scripts/dev-hq.mjs
@@ -4,7 +4,7 @@ import { join } from "node:path";
 import { createHash } from "node:crypto";
 import { spawnSync } from "node:child_process";
 import { listedInStand, readSpecStatuses, reconcile } from "./lib/active-specs.mjs";
-import { parseNextGrip, parseSpecTable, buildNext, parseFindings, buildPackages, applySpecStartable } from "./lib/hq-parse.mjs";
+import { parseNextGrip, parseSpecTable, buildNext, parseFindings, buildPackages, parseMilestones, applySpecStartable } from "./lib/hq-parse.mjs";
 import { lessonBadges, lessonStats, readLessonsFile } from "./lib/hq-lessons.mjs";
 
 function arg(flag, fallback) {
@@ -47,7 +47,10 @@ const reportFiles = existsSync(specDir)
   : [];
 const reportF0 = reportFiles.map((f) => f.text).join("\n");
 const warnings = [...rec.warnings];
-const packages = buildPackages(standText, specs);
+const packages = buildPackages(standText, specs); // only gates buildNext; not part of the snapshot
+const planPath = join(root, "docs", "PLAN.md");
+const milestones = existsSync(planPath) ? parseMilestones(readFileSync(planPath, "utf8")) : [];
+if (!milestones.length) warnings.push("docs/PLAN.md: no milestone tables (### M<n> — …) found");
 const findings = parseFindings(standText, { reportF0, reportFiles, warnings });
 const lessons = readLessonsFile(join(out, "lessons.json"));
 const citedReports = [...new Set(findings.map((f) => f.source).filter((s) => s.startsWith(".pa/")))];
@@ -65,7 +68,7 @@ const data = {
   nextGrip,
   specs,
   findings,
-  packages,
+  milestones,
   next: buildNext(nextGrip, specs, packages),
   lessons: lessons.map((l) => ({ ...l, badges: lessonBadges(l) })),
   lessonStats: lessonStats(lessons),
diff --git a/scripts/hq-live.mjs b/scripts/hq-live.mjs
index 85537da..25ed1f9 100644
--- a/scripts/hq-live.mjs
+++ b/scripts/hq-live.mjs
@@ -18,6 +18,7 @@ import {
   parseBuiltinProfiles,
   readAgentsFile,
   resolveAgentsFile,
+  snapshotProgress,
   upsertProfile,
   validateProfile,
   writeAgentsFile,
@@ -140,8 +141,6 @@ function analysis() {
   }, 0);
   const dataPath = join(docs, "data.json");
   const snapshot = existsSync(dataPath) ? JSON.parse(readFileSync(dataPath, "utf8")) : {};
-  const packages = snapshot.packages || [];
-  const donePackages = packages.filter((item) => item.current === "done").length;
   const remainingSpecs = (snapshot.specs || []).filter((item) => item.startable !== false).length;
   const commits = git(["log", "--since=30 days ago", "--format=%h"]).split(/\r?\n/).filter(Boolean).length;
   const estimatedHours = Math.max(remainingSpecs * 4, 2);
@@ -152,9 +151,7 @@ function analysis() {
     lines: { source: countLines(source), code: countLines(code) },
     commitsLast30Days: commits,
     progress: {
-      packagesDone: donePackages,
-      packagesTotal: packages.length,
-      percent: packages.length ? Math.round((donePackages / packages.length) * 100) : 0,
+      ...snapshotProgress(snapshot),
       activeSpecs: remainingSpecs,
     },
     estimate: {
diff --git a/scripts/lib/hq-a11y.test.mjs b/scripts/lib/hq-a11y.test.mjs
index f308213..d7555ac 100644
--- a/scripts/lib/hq-a11y.test.mjs
+++ b/scripts/lib/hq-a11y.test.mjs
@@ -162,14 +162,14 @@ test("HQ-10/HQ-22: setup rows state their status as text, the dot is decorative
   assert.equal(f.document.querySelector("[onmouseover]"), null, "state value is escaped");
 });
 
-test("HQ-13: the Now page thumbnail DAG has no tab stops inside its link", () => {
+test("HQ-13: the Now page milestone list is plain text plus one link, no tab stops inside", () => {
   const dom = new JSDOM(source("docs/dev-hq/index.html"), { url: "http://localhost/index.html", runScripts: "outside-only" });
   dom.window.HQ_DATA = JSON.parse(source("docs/dev-hq/data.json"));
   dom.window.matchMedia = () => ({ matches: true });
   dom.window.eval(HQ_JS);
-  const mini = dom.window.document.querySelector("#mini-dag");
-  assert.ok(mini && mini.querySelector("g"), "mini DAG drawn");
-  assert.equal(mini.querySelectorAll("[tabindex]").length, 0);
+  const items = dom.window.document.querySelectorAll(".signal-list li");
+  assert.ok([...items].some((li) => /^M\d/.test(li.querySelector("strong")?.textContent ?? "")), "milestone list drawn");
+  assert.equal(dom.window.document.querySelectorAll("li [tabindex]").length, 0);
   dom.window.close();
 });
 
@@ -357,18 +357,16 @@ test("HQ-11: the control fields carry visible labels", (t) => {
   }
 });
 
-test("HQ-9: charts are followed by a table with the same numbers; DAG nodes are named images", () => {
+test("HQ-9: charts are followed by a table with the same numbers; the milestone tables have column headers", () => {
   assert.match(HQ_JS, /chart-table.*Commits per day/);
   assert.match(HQ_JS, /chart-table.*Commits by weekday and hour/);
   const dom = new JSDOM(source("docs/dev-hq/map.html"), { url: "http://localhost/map.html", runScripts: "outside-only" });
   dom.window.HQ_DATA = JSON.parse(source("docs/dev-hq/data.json"));
   dom.window.matchMedia = () => ({ matches: true });
   dom.window.eval(HQ_JS);
-  const svg = dom.window.document.querySelector("#dag");
-  assert.equal(svg.getAttribute("role"), "group", "the full DAG is a group, so its children are exposed");
-  const nodes = [...svg.querySelectorAll("g[tabindex]")];
-  assert.ok(nodes.length > 0);
-  assert.ok(nodes.every((g) => g.getAttribute("role") === "img" && g.getAttribute("aria-label")));
+  const tables = [...dom.window.document.querySelectorAll(".package-table")];
+  assert.ok(tables.length > 0, "one table per milestone");
+  assert.ok(tables.every((t) => t.querySelectorAll('thead th[scope="col"]').length === 5));
   dom.window.close();
 });
 
diff --git a/scripts/lib/hq-html.test.mjs b/scripts/lib/hq-html.test.mjs
index abe273a..f114d12 100644
--- a/scripts/lib/hq-html.test.mjs
+++ b/scripts/lib/hq-html.test.mjs
@@ -40,10 +40,9 @@ test("self-hosted Recursive face, no Google Fonts in CSS", () => {
   assert.ok(woff.length > 1000);
 });
 
-test("motion: DAG stroke key, reduced-motion instant", () => {
+test("motion: reduced-motion instant", () => {
   const css = readFileSync(join(DIR, "hq.css"), "utf8");
   const js = readFileSync(join(DIR, "hq.js"), "utf8");
-  assert.match(js, /hq-dag-drawn/);
   assert.match(css, /prefers-reduced-motion:\s*reduce/);
   assert.match(css, /animation:\s*none\s*!important/);
   assert.match(css, /@keyframes\s+hq-in/);
diff --git a/scripts/lib/hq-lanes.test.mjs b/scripts/lib/hq-lanes.test.mjs
index bc28b82..b07304e 100644
--- a/scripts/lib/hq-lanes.test.mjs
+++ b/scripts/lib/hq-lanes.test.mjs
@@ -30,7 +30,7 @@ class Node {
 }
 
 function renderNowLanes(data) {
-  const byId = { mount: new Node("div"), lane: new Node("div"), "mini-dag": new Node("svg") };
+  const byId = { mount: new Node("div"), lane: new Node("div") };
   const document = {
     getElementById: (id) => byId[id] || null,
     querySelector: () => null,
diff --git a/scripts/lib/hq-live-lib.mjs b/scripts/lib/hq-live-lib.mjs
index e79f82b..9230aaa 100644
--- a/scripts/lib/hq-live-lib.mjs
+++ b/scripts/lib/hq-live-lib.mjs
@@ -6,6 +6,14 @@ import { join, dirname } from "node:path";
 
 const PROFILE_ID = /^[a-z0-9][a-z0-9-]*$/;
 
+/// Progress over the milestone packages of docs/PLAN.md (done / all).
+export function snapshotProgress(snapshot) {
+  const milestones = snapshot?.milestones || [];
+  const packagesDone = milestones.reduce((sum, m) => sum + m.done, 0);
+  const packagesTotal = milestones.reduce((sum, m) => sum + m.total, 0);
+  return { packagesDone, packagesTotal, percent: packagesTotal ? Math.round((packagesDone / packagesTotal) * 100) : 0 };
+}
+
 /// Validate one custom profile coming from the HQ UI.
 /// Returns an error string, or null when the profile is acceptable.
 export function validateProfile(profile) {
diff --git a/scripts/lib/hq-live.test.mjs b/scripts/lib/hq-live.test.mjs
index ae7de3b..b14f012 100644
--- a/scripts/lib/hq-live.test.mjs
+++ b/scripts/lib/hq-live.test.mjs
@@ -11,6 +11,7 @@ import {
   mergeProfileViews,
   resolveAgentsFile,
 } from "./hq-live-lib.mjs";
+import * as lib from "./hq-live-lib.mjs";
 
 // The proxy resolves the API descriptor like Tauri does: APPDATA (Roaming)
 // before LOCALAPPDATA on Windows. Asserted against the script source so a
@@ -139,3 +140,11 @@ test("resolveAgentsFile falls back to debug when nothing was built yet", () => {
   const fs = { existsSync: () => false, statSync: () => ({ mtimeMs: 0 }) };
   assert.equal(resolveAgentsFile("root", {}, fs), join("root", "src-tauri", "target", "debug", "agents.json"));
 });
+
+// The live cockpit's progress figure counts milestone packages (PLAN.md
+// tables), not the retired F0-F8 packages that showed as "waiting".
+test("snapshotProgress counts done packages over all milestone packages", () => {
+  const snapshot = { milestones: [{ id: "M1", done: 2, total: 2 }, { id: "M2", done: 1, total: 4 }, { id: "M3", done: 0, total: 3 }] };
+  assert.deepEqual(lib.snapshotProgress(snapshot), { packagesDone: 3, packagesTotal: 9, percent: 33 });
+  assert.deepEqual(lib.snapshotProgress({}), { packagesDone: 0, packagesTotal: 0, percent: 0 });
+});
diff --git a/scripts/lib/hq-pages.test.mjs b/scripts/lib/hq-pages.test.mjs
index 7c52694..ea4dfa1 100644
--- a/scripts/lib/hq-pages.test.mjs
+++ b/scripts/lib/hq-pages.test.mjs
@@ -1,4 +1,4 @@
-// scripts/lib/hq-pages.test.mjs — Map DAG / Proof / Next / Sources contracts
+// scripts/lib/hq-pages.test.mjs — Map milestones / Proof / Next / Sources contracts
 import { test } from "node:test";
 import assert from "node:assert/strict";
 import { readFileSync } from "node:fs";
@@ -7,49 +7,15 @@ import { join } from "node:path";
 const HQ_JS = readFileSync(join("docs", "dev-hq", "hq.js"), "utf8");
 const DATA = JSON.parse(readFileSync(join("docs", "dev-hq", "data.json"), "utf8"));
 
-test("drawDag: fixed Rev 9 coordinates and caption", () => {
-  assert.match(HQ_JS, /function drawDag\s*\(/);
-  assert.match(HQ_JS, /F0:\s*\[\s*40\s*,\s*80\s*\]/);
-  assert.match(HQ_JS, /F1:\s*\[\s*180\s*,\s*80\s*\]/);
-  assert.match(HQ_JS, /F4:\s*\[\s*320\s*,\s*80\s*\]/);
-  assert.match(HQ_JS, /F5:\s*\[\s*460\s*,\s*80\s*\]/);
-  assert.match(HQ_JS, /F8:\s*\[\s*600\s*,\s*140\s*\]/);
-  assert.match(HQ_JS, /F2:\s*\[\s*180\s*,\s*200\s*\]/);
-  assert.match(HQ_JS, /F6-UI"?:\s*\[\s*320\s*,\s*200\s*\]/);
-  assert.match(HQ_JS, /F3:\s*\[\s*320\s*,\s*140\s*\]/);
-  assert.match(HQ_JS, /F6-Attribution"?:\s*\[\s*460\s*,\s*200\s*\]/);
-  assert.match(HQ_JS, /F7:\s*\[\s*40\s*,\s*200\s*\]/);
-  assert.match(HQ_JS, /Package DAG · Source: docs\/PLAN\.md/);
-});
-
-test("drawDag: lines before circles; F3 title cites dependsOn", () => {
-  const fn = HQ_JS.slice(HQ_JS.indexOf("function drawDag"));
-  const lineAt = fn.indexOf('createElementNS(NS, "line")');
-  const circleAt = fn.indexOf('createElementNS(NS, "circle")');
-  assert.ok(lineAt >= 0 && circleAt > lineAt, "draw lines before circles");
-  assert.match(fn, /dependsOn/);
-  assert.match(fn, /id · lane · source|\$\{p\.id\} · \$\{p\.lane\} · \$\{p\.source\}/);
-});
-
-test("renderMap mounts #dag; Now fills #mini-dag", () => {
+test("Map renders the PLAN.md milestone tables; Now shows milestone progress", () => {
   assert.match(HQ_JS, /function renderMap\s*\(/);
-  assert.match(HQ_JS, /id="dag"/);
   assert.match(HQ_JS, /page === "map"/);
-  assert.match(HQ_JS, /drawDag\([^,]+,\s*data\.packages/);
-  assert.match(HQ_JS, /getElementById\("mini-dag"\)/);
-  const pos = HQ_JS.indexOf("const DAG_POS");
+  assert.match(HQ_JS, /milestones\.map\(milestoneTable\)/);
+  assert.match(HQ_JS, /\$\{milestoneProgress\(data\)\}/);
+  assert.doesNotMatch(HQ_JS, /drawDag|DAG_POS|mini-dag/, "the F0-F8 package DAG is gone");
+  const pos = HQ_JS.indexOf("const MILESTONE_STATE");
   const dispatch = HQ_JS.lastIndexOf('page === "now"');
-  assert.ok(pos >= 0 && dispatch > pos, "dispatch after DAG_POS to avoid TDZ");
-});
-
-test("live packages encode F3 → F1 and F2 (Rev 9)", () => {
-  const f3 = DATA.packages.find((p) => p.id === "F3");
-  assert.deepEqual(f3.dependsOn, ["F1", "F2"]);
-  const f8 = DATA.packages.find((p) => p.id === "F8");
-  assert.ok(f8.dependsOn.includes("F5"));
-  assert.ok(f8.dependsOn.includes("F6-UI"));
-  assert.ok(f8.dependsOn.includes("F3"));
-  assert.ok(f8.dependsOn.includes("F6-Attribution"));
+  assert.ok(pos >= 0 && dispatch > pos, "dispatch after MILESTONE_STATE to avoid TDZ");
 });
 
 test("Proof: matrix by packet, no pie, omit empty klass columns", () => {
@@ -68,20 +34,6 @@ test("Proof: matrix by packet, no pie, omit empty klass columns", () => {
   }
 });
 
-test("live packages: active only with an executable spec, F0 done per STAND", () => {
-  // Bound to the contract, not to one STAND revision: a package is "active"
-  // only while an executable spec names it; F0 is "done" once STAND says so.
-  for (const p of DATA.packages) {
-    if (p.current === "active") {
-      assert.ok(DATA.specs.some((s) => s.packet.startsWith(p.id.replace(/-.*$/, ""))), `${p.id} active without spec`);
-    }
-  }
-  const stand = readFileSync("STAND.md", "utf8");
-  if (/F0 ist abgeschlossen/i.test(stand)) {
-    assert.equal(DATA.packages.find((p) => p.id === "F0").current, "done");
-  }
-});
-
 test("live Now grip is STAND prose, not UNPROVEN", () => {
   assert.ok(DATA.nextGrip.length >= 1, "nextGrip must copy STAND §3 prose");
   // Bound to the source, not to one phrasing: the grip changes with every
@@ -146,3 +98,15 @@ test("Sources: table plus outbound STAND / Sanierungsplan / ui-variants", () =>
   assert.match(HQ_JS, /\.\.\/\.\.\/STAND\.md/);
   assert.match(HQ_JS, /\.\.\/ui-variants\/index\.html/);
 });
+
+test("live snapshot lists the PLAN.md milestones with consistent progress", () => {
+  const ids = DATA.milestones.map((m) => m.id);
+  assert.deepEqual(ids, ["M1", "M2", "M3", "M4"]);
+  for (const m of DATA.milestones) {
+    assert.ok(m.title && m.packages.length > 0, `${m.id} has a title and packages`);
+    assert.equal(m.total, m.packages.length);
+    assert.equal(m.done, m.packages.filter((p) => p.state === "done").length);
+    for (const p of m.packages) assert.ok(["done", "open", "in_progress", "pr"].includes(p.state), `${p.id}: ${p.state}`);
+  }
+  assert.equal(DATA.packages, undefined, "the retired F0-F8 packages are not part of the snapshot");
+});
diff --git a/scripts/lib/hq-parse.mjs b/scripts/lib/hq-parse.mjs
index bba7f12..7c70de7 100644
--- a/scripts/lib/hq-parse.mjs
+++ b/scripts/lib/hq-parse.mjs
@@ -229,6 +229,61 @@ export function buildPackages(standText, specs) {
   });
 }
 
+const tableCells = (line) =>
+  line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());
+
+// "Stand" cell of a PLAN.md milestone table → done | pr | in_progress | open.
+// "✓ #n" = merged; a cell that mixes merged and pending sub-packages
+// ("10a ✓ #13, 10c offen") counts as in progress.
+function milestoneState(stand) {
+  if (/^in Arbeit|^dieses Paket/i.test(stand)) return "in_progress";
+  if (/^PR #\d/.test(stand)) return "pr";
+  if (!stand.includes("✓")) return "open";
+  return /offen|PR #\d|in Arbeit/.test(stand) ? "in_progress" : "done";
+}
+
+/// The milestone sections "### M<n> — title" of docs/PLAN.md with their tables
+/// (ID | Paket | Gr. | Lane | Stand). Other sections and tables are ignored.
+export function parseMilestones(planText) {
+  const lines = String(planText).split(/\r?\n/);
+  const milestones = [];
+  let current = null;
+  for (let i = 0; i < lines.length; i++) {
+    const heading = lines[i].match(/^###\s+(M\d+)\s+[—–-]\s+(.+?)\s*$/);
+    if (heading) {
+      current = { id: heading[1], title: heading[2], packages: [], done: 0, total: 0 };
+      milestones.push(current);
+      continue;
+    }
+    if (/^#{1,3}\s/.test(lines[i])) {
+      current = null;
+      continue;
+    }
+    if (!current || !lines[i].startsWith("|") || !/^\|[-|: ]+\|\s*$/.test(lines[i + 1] || "")) continue;
+    const head = tableCells(lines[i]);
+    const col = (name) => head.indexOf(name);
+    if (head[0] !== "ID" || col("Stand") === -1) continue;
+    for (let j = i + 2; j < lines.length && lines[j].startsWith("|"); j++) {
+      const c = tableCells(lines[j]);
+      const stand = c[col("Stand")] ?? "";
+      current.packages.push({
+        id: c[0],
+        title: (c[col("Paket")] ?? "").replace(/`|\*\*/g, ""),
+        size: c[col("Gr.")] ?? "",
+        lane: c[col("Lane")] ?? "",
+        stand,
+        state: milestoneState(stand),
+        prNumbers: [...stand.matchAll(/#(\d+)/g)].map((m) => Number(m[1])),
+      });
+    }
+  }
+  for (const m of milestones) {
+    m.total = m.packages.length;
+    m.done = m.packages.filter((p) => p.state === "done").length;
+  }
+  return milestones;
+}
+
 function extractBehebungPacket(blockText) {
   const packetMatch = blockText.match(/Behebung in (F\d+\S*?)\s*(?:[.,;:]|$)/);
   return packetMatch ? packetMatch[1] : null;
diff --git a/scripts/lib/hq-parse.test.mjs b/scripts/lib/hq-parse.test.mjs
index ee1453a..83eaafe 100644
--- a/scripts/lib/hq-parse.test.mjs
+++ b/scripts/lib/hq-parse.test.mjs
@@ -13,6 +13,7 @@ import {
   buildPackages,
   applySpecStartable,
 } from "./hq-parse.mjs";
+import * as parseAll from "./hq-parse.mjs";
 
 const FIXTURE = `
 ## 3. Nächster Griff
@@ -381,3 +382,91 @@ test("missing STAND → exit 1 and no data.json", () => {
   assert.equal(JSON.parse(readFileSync(stale, "utf8")).keep, true);
   assert.equal(existsSync(join(root, "docs", "dev-hq", "data.js")), false);
 });
+
+// Excerpt of the real docs/PLAN.md structure: the M overview table (header "M",
+// not "ID"), the lane legend, one table per "### M<n> — title" section, prose
+// after a table, mixed Stand cells, and a later section with a table that must
+// not be read.
+const PLAN_FIXTURE = `
+## Meilensteine
+
+| M | Titel | Abnahme in Alltagssprache |
+|---|---|---|
+| M1 | Alles Laufende gelandet, App startbar | Keine offenen Paket-PRs. |
+
+### M1 — Alles Laufende gelandet, App startbar
+
+| ID | Paket | Gr. | Lane | Stand |
+|---|---|---|---|---|
+| W2-03 | Usage-/Billing-Collectors je **\`Adapter\`** | M | st | ✓ #140 |
+| W1-05b | Sichere Cancel-Regel; erst st-Kind, dann api-Kind | M | st → api | ✓ #19 |
+
+### M2 — Überblick und Setup
+
+| ID | Paket | Gr. | Lane | Stand |
+|---|---|---|---|---|
+| PLAN-01 | Ein Plan, zehn Regeln | M | doc | dieses Paket |
+| OPS-01 | Status und Tagesbericht per Skript | M | doc | PR #164 |
+| CLEAN-02 | Stillgelegten Pfad löschen (a \\| b) | S | api → mn → wk | ✓ #25 |
+| SETUP-14 | Nutzer: tote Keys | S | N | offen |
+
+PC-Setup außerhalb des Repos: Backup mit Kopia.
+
+### M3 — App im Alltag + Zwischenrelease v1.5.0-beta
+
+| ID | Paket | Gr. | Lane | Stand |
+|---|---|---|---|---|
+| W2-10 | Live-HQ-Views | M | hqL | 10a ✓ #13, 10b ✓ #21, 10c offen |
+| W1-18b | Probe Codex/OpenCode | S | wk + N | in Arbeit |
+| R-1 | Zwischenrelease | S | N + doc | offen |
+
+### Reihenfolge der seriellen Lanes (nach Meilensteinen)
+
+| ID | Paket | Gr. | Lane | Stand |
+|---|---|---|---|---|
+| X-1 | not a milestone package | S | ci | offen |
+`;
+
+test("parseMilestones reads the M1-M3 tables of the real PLAN.md structure", () => {
+  const ms = parseAll.parseMilestones(PLAN_FIXTURE);
+  assert.deepEqual(ms.map((m) => m.id), ["M1", "M2", "M3"]);
+  assert.equal(ms[0].title, "Alles Laufende gelandet, App startbar");
+  assert.equal(ms[2].title, "App im Alltag + Zwischenrelease v1.5.0-beta");
+  assert.deepEqual(ms.map((m) => [m.done, m.total]), [[2, 2], [1, 4], [0, 3]]);
+  const row = (mid, id) => ms.find((m) => m.id === mid).packages.find((p) => p.id === id);
+  assert.deepEqual(row("M1", "W1-05b"), {
+    id: "W1-05b", title: "Sichere Cancel-Regel; erst st-Kind, dann api-Kind",
+    size: "M", lane: "st → api", stand: "✓ #19", state: "done", prNumbers: [19],
+  });
+  assert.equal(row("M1", "W2-03").title, "Usage-/Billing-Collectors je Adapter", "inline markup (code ticks, bold) is dropped");
+  assert.equal(row("M2", "PLAN-01").state, "in_progress");
+  assert.equal(row("M2", "OPS-01").state, "pr");
+  assert.deepEqual(row("M2", "OPS-01").prNumbers, [164]);
+  assert.equal(row("M2", "CLEAN-02").state, "done");
+  assert.equal(row("M2", "CLEAN-02").title, "Stillgelegten Pfad löschen (a | b)");
+  assert.equal(row("M2", "SETUP-14").state, "open");
+  assert.equal(row("M3", "W2-10").state, "in_progress", "some sub-packages merged, some open");
+  assert.deepEqual(row("M3", "W2-10").prNumbers, [13, 21]);
+  assert.equal(row("M3", "W1-18b").state, "in_progress");
+  assert.equal(row("M3", "R-1").state, "open");
+  assert.ok(!ms.some((m) => m.packages.some((p) => p.id === "X-1")), "later tables are not read");
+});
+
+test("parseMilestones yields nothing when PLAN.md has no milestone sections", () => {
+  assert.deepEqual(parseAll.parseMilestones("# Plan\n\n| ID | Paket |\n|---|---|\n| A | b |\n"), []);
+});
+
+test("dev-hq snapshot carries the PLAN.md milestones and no F-package DAG", () => {
+  const root = mkdtempSync(join(tmpdir(), "hq-ms-"));
+  mkdirSync(join(root, "docs"), { recursive: true });
+  writeFileSync(join(root, "STAND.md"), "# STAND\n\n## Aktive Specs\n\n| Spec | Paket | Lane |\n|---|---|---|\n");
+  writeFileSync(join(root, "docs", "PLAN.md"), PLAN_FIXTURE);
+  const out = join(root, "docs", "dev-hq");
+  const r = spawnSync(process.execPath, ["scripts/dev-hq.mjs", "--root", root, "--out", out], { encoding: "utf8" });
+  assert.equal(r.status, 0, r.stderr);
+  const data = JSON.parse(readFileSync(join(out, "data.json"), "utf8"));
+  assert.deepEqual(data.milestones.map((m) => m.id), ["M1", "M2", "M3"]);
+  assert.equal(data.milestones[1].done, 1);
+  assert.equal(data.packages, undefined, "the F0-F8 DAG is no longer emitted");
+  assert.match(readFileSync(join(out, "data.js"), "utf8"), /"milestones"/);
+});
diff --git a/scripts/lib/hq-stats.mjs b/scripts/lib/hq-stats.mjs
index 10c46d3..5db3fee 100644
--- a/scripts/lib/hq-stats.mjs
+++ b/scripts/lib/hq-stats.mjs
@@ -39,15 +39,15 @@ export function testSurface(files, rustTestCount = 0) {
 }
 
 /// What the snapshot already knows: findings by class, specs by lane/lock,
-/// packages by state.
+/// milestone packages (docs/PLAN.md) by state.
 export function snapshotStats(snapshot) {
   const findings = snapshot?.findings || [];
   const specs = snapshot?.specs || [];
-  const packages = snapshot?.packages || [];
+  const packages = (snapshot?.milestones || []).flatMap((m) => m.packages);
   const byKlass = {};
   for (const f of findings) byKlass[f.klass || "UNKNOWN"] = (byKlass[f.klass || "UNKNOWN"] || 0) + 1;
   const byState = {};
-  for (const p of packages) byState[p.current || "unknown"] = (byState[p.current || "unknown"] || 0) + 1;
+  for (const p of packages) byState[p.state || "unknown"] = (byState[p.state || "unknown"] || 0) + 1;
   return {
     findings: { total: findings.length, ...byKlass },
     specs: {
diff --git a/scripts/lib/hq-stats.test.mjs b/scripts/lib/hq-stats.test.mjs
index 89e60d8..46643fd 100644
--- a/scripts/lib/hq-stats.test.mjs
+++ b/scripts/lib/hq-stats.test.mjs
@@ -22,11 +22,11 @@ test("snapshotStats and fleetStats aggregate what the pages show", () => {
   const snap = snapshotStats({
     findings: [{ klass: "FACT" }, { klass: "FACT" }, { klass: "CLAIM" }],
     specs: [{ lane: "serial", startable: true }, { lane: "serial", startable: false }, { lane: "parallel" }],
-    packages: [{ current: "done" }, { current: "active" }],
+    milestones: [{ packages: [{ state: "done" }, { state: "open" }] }, { packages: [{ state: "done" }] }],
   });
   assert.equal(snap.findings.FACT, 2);
   assert.deepEqual(snap.specs, { total: 3, serial: 2, parallel: 1, startable: 2, locked: 1 });
-  assert.equal(snap.packages.done, 1);
+  assert.deepEqual(snap.packages, { total: 3, done: 2, open: 1 });
   const fleet = fleetStats([{ column: "working", contextUsage: { used: 50, total: 100 } }, { column: "working" }, { column: "done" }]);
   assert.deepEqual(fleet, { workers: 3, columns: { working: 2, done: 1 }, contextPercent: 50 });
 });

```
