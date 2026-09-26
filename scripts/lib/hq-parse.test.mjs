// scripts/lib/hq-parse.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseNextGrip,
  parseSpecTable,
  buildNext,
  parseFindings,
  buildPackages,
  applySpecStartable,
} from "./hq-parse.mjs";
import * as parseAll from "./hq-parse.mjs";

const FIXTURE = `
## 3. Nächster Griff

**F0 ist abgeschlossen** (04.09.2026).

1. **F1 in dieser Reihenfolge:** Single-Instance zuerst (besitzt \`main.rs\`),
   dann Diagnostics.
2. **F0-Abnahme nachziehen:** \`.pa/task_f0_db_fixtures.md\`.

### Aktive Specs

| Spec | Paket | Lane |
|---|---|---|
| \`.pa/task_f0_db_fixtures.md\` | F0-Abnahme | nur \`store.rs\`-Tests, parallel |
| \`.pa/task_f1_single_instance.md\` | F1: eine Flotte | **seriell (\`main.rs\`), geht zuerst** |
| \`.pa/task_f1_diagnostics.md\` | F1: Diagnose | **seriell (\`main.rs\`), nach Single-Instance** |
`;

const FIND_FIXTURE = `
## 4. Bewusst offene Produktbefunde

- NT-4: Terminal-Pane kann bis zum ersten Repaint schwarz bleiben.
- NT-5/P2-D: Agenten-/Quota-Fehler erreichen den aktiven Dialog nicht
  zuverlässig.
- P2-H: kein bedienbarer Diagnoseexport und keine „Warum?"-Ansicht.
- KI-8: \`useBoard\` kann bei überholtem Erst-Load im Spinner bleiben.
- NT-7/NT-11: Navigation bei 1280 px und UIA-Accessibility sind nicht
  abgeschlossen.
- Session-Restore existiert nicht.

Neu aus F0 (04.09.), alle mit Beleg in \`.pa/report_f0.md\` §2/§3:

- **F0-1: \`POST /api/workers/<id>/merge\` steht nicht hinter dem Verdict-Token.**
  \`is_verdict\` (\`api.rs:903-914\`) deckt nur \`learnings|roles … approve|reject\`.
  Der API-Token liegt in einer Datei, die jeder Agent lesen kann — die Modul-Doku
  begründet den zweiten Token selbst damit (\`api.rs:27-29\`). Gilt genauso für
  \`pa worker merge\`. Behebung in F4.
- **F0-2: Ein Handpin umgeht den Merge-Guard vollständig.** Der Guard prüft nur
  die abgeleitete Spalte (\`workers.rs:1334-1346\`).
`;

test("parseNextGrip copies numbered items in order", () => {
  const items = parseNextGrip(FIXTURE);
  assert.equal(items.length, 2);
  assert.match(items[0].text, /Single-Instance/);
  assert.equal(items[0].source, "STAND.md#Nächster Griff");
});

test("parseSpecTable: main.rs cell → serial owner", () => {
  const specs = parseSpecTable(FIXTURE, [
    "task_f0_db_fixtures.md",
    "task_f1_single_instance.md",
    "task_f1_diagnostics.md",
  ]);
  assert.equal(specs.length, 3);
  const si = specs.find((s) => s.file.endsWith("single_instance.md"));
  assert.equal(si.lane, "serial");
  assert.equal(si.serialOwner, "main.rs");
  const fx = specs.find((s) => s.file.endsWith("fixtures.md"));
  assert.equal(fx.lane, "parallel");
  assert.equal(fx.serialOwner, null);
});

test("serial lock: two main.rs specs → one startable", () => {
  const specs = parseSpecTable(FIXTURE, [
    "task_f0_db_fixtures.md",
    "task_f1_single_instance.md",
    "task_f1_diagnostics.md",
  ]);
  const next = buildNext(parseNextGrip(FIXTURE), specs);
  const serial = next.filter((n) => n.serialOwner === "main.rs");
  assert.equal(serial.length, 2);
  assert.equal(serial.filter((n) => n.startable).length, 1);
  assert.equal(serial[0].startable, true);
  assert.equal(serial[1].startable, false);
  // STAND §3 order: Single-Instance first (startable), Diagnostics locked
  assert.match(serial[0].doneWhen, /single_instance/);
  assert.match(serial[1].doneWhen, /diagnostics/);
});

test("F0-1 with report cite is FACT; NT-4 is CLAIM", () => {
  const findings = parseFindings(FIND_FIXTURE);
  const f01 = findings.find((f) => f.id === "F0-1");
  const nt4 = findings.find((f) => f.id === "NT-4");
  assert.equal(f01.klass, "FACT");
  assert.equal(f01.source, ".pa/report_f0.md");
  assert.equal(f01.packet, "F4");
  assert.equal(nt4.klass, "CLAIM");
  assert.equal(nt4.source, "STAND.md");
  for (const f of findings) {
    assert.ok(f.source || f.klass === "UNPROVEN");
  }
});

test("multi-line F0 Behebung + composite claim ids from STAND §4", () => {
  const findings = parseFindings(FIND_FIXTURE);
  const f01 = findings.find((f) => f.id === "F0-1");
  const f02 = findings.find((f) => f.id === "F0-2");
  assert.equal(f01.packet, "F4");
  assert.equal(f02.packet, null);
  const nt5 = findings.find((f) => f.id === "NT-5/P2-D");
  const nt7 = findings.find((f) => f.id === "NT-7/NT-11");
  assert.ok(nt5, "NT-5/P2-D must be kept as one composite id");
  assert.equal(nt5.klass, "CLAIM");
  assert.ok(nt7, "NT-7/NT-11 must be kept as one composite id");
  assert.equal(
    findings.some((f) => f.id === "Session-Restore" || /Session-Restore/i.test(f.text)),
    false,
    "unlabeled §4 bullets stay omitted",
  );
});

test("packages: F0 done when STAND says abgeschlossen; F1 active if specs exist", () => {
  const pkgs = buildPackages(FIXTURE, [
    { file: ".pa/task_f1_single_instance.md", packet: "F1" },
  ]);
  assert.equal(pkgs.find((p) => p.id === "F0").current, "done");
  assert.equal(pkgs.find((p) => p.id === "F1").current, "active");
  assert.equal(pkgs.find((p) => p.id === "F4").current, "waiting");
  const f3 = pkgs.find((p) => p.id === "F3");
  assert.deepEqual(f3.dependsOn, ["F1", "F2"]);
});

test("packages: longest PACKAGE_EDGES id wins for F6-UI / F6-Attribution", () => {
  const pkgs = buildPackages(FIXTURE, [
    { file: ".pa/task_f6_ui.md", packet: "F6-UI: Landing ohne Verlust" },
    { file: ".pa/task_f6_attr.md", packet: "F6-Attribution: Ledger" },
  ]);
  assert.equal(pkgs.find((p) => p.id === "F6-UI").current, "active");
  assert.equal(pkgs.find((p) => p.id === "F6-Attribution").current, "active");
  assert.equal(
    pkgs.find((p) => p.id === "F6"),
    undefined,
    "plain F6 is not a PACKAGE_EDGES node",
  );
});

test("F0-7 glob asterisk still parses; unmatched F0 goes to warnings", () => {
  const line =
    "- **F0-7: `.pre-migration-*.bak` hat keinen Rückweg.** `restore-probe.sh` sieht";
  const warnings = [];
  const findings = parseFindings(
    `## 4. Bewusst offene Produktbefunde\n\nNeu aus F0, Beleg in \`.pa/report_f0.md\`:\n\n${line}\n`,
    { warnings },
  );
  const f07 = findings.find((f) => f.id === "F0-7");
  assert.ok(f07, "F0-7 must not be dropped because of * in the glob");
  assert.match(f07.text, /pre-migration-\*\.bak/);
  assert.equal(warnings.length, 0);
});

test("F0-7 is CLAIM when report_f0.md has no restore-path cite", () => {
  const stand = `## 4. Bewusst offene Produktbefunde

Neu aus F0, alle mit Beleg in \`.pa/report_f0.md\` §2/§3:

- **F0-1: merge token.** Behebung in F4.
- **F0-7: \`.pre-migration-*.bak\` hat keinen Rückweg.**
`;
  const findings = parseFindings(stand, {
    reportF0:
      "## 5. Migrations- und Legacy-Vertrag\nversioniert, transaktional, durch Pre-Migration-Backups\nTest-Abnahme, keine Restore-CLI.\n",
  });
  assert.equal(findings.find((f) => f.id === "F0-1").klass, "FACT");
  const f07 = findings.find((f) => f.id === "F0-7");
  assert.equal(f07.klass, "CLAIM");
  assert.equal(f07.source, "STAND.md");
});

test("parseNextGrip stops at unindented closing prose", () => {
  const stand = `### Nächster Griff

1. **F8 isoliert:** proof script.
2. F0-7 Restore-Pfad für \`.pre-migration-*.bak\` bleibt offen.

Nächster Code-Griff: F8-isolierte Kreuzmatrix, nicht neue Produktflächen.
`;
  const items = parseNextGrip(stand);
  assert.equal(items.length, 2);
  assert.doesNotMatch(items[1].text, /Nächster Code-Griff/);
  assert.match(items[1].text, /F0-7 Restore-Pfad/);
});

test("parallel lane mentioning main.rs is not serial", () => {
  const stand = `### Aktive Specs
| Spec | Paket | Lane |
|---|---|---|
| \`.pa/task_f4_readiness.md\` | F4: Lifecycle | parallel (\`readiness.rs\`; eine \`mod\`-Zeile in \`main.rs\`) |
| \`.pa/task_f4_persist.md\` | F4: Evidence | **seriell (\`store.rs\`), nach Readiness** |
`;
  const specs = parseSpecTable(stand, ["task_f4_readiness.md", "task_f4_persist.md"]);
  const ready = specs.find((s) => s.file.endsWith("readiness.md"));
  const persist = specs.find((s) => s.file.endsWith("persist.md"));
  assert.equal(ready.lane, "parallel");
  assert.equal(ready.serialOwner, null);
  assert.equal(persist.lane, "serial");
  assert.equal(persist.serialOwner, "store.rs");
});

test("buildNext: unmet package dependsOn is not startable; Attention matches", () => {
  const specs = [
    { file: ".pa/task_f1_attention.md", packet: "F1: Reason-Codes", lane: "parallel", serialOwner: null },
    { file: ".pa/task_f1_single_instance.md", packet: "F1: eine Flotte", lane: "serial", serialOwner: "main.rs" },
  ];
  const pkgs = buildPackages("**F0 ist abgeschlossen** (04.09.2026).\n", specs);
  assert.equal(pkgs.find((p) => p.id === "F1").current, "active");
  assert.equal(pkgs.find((p) => p.id === "F4").current, "waiting");
  const next = buildNext(
    [
      { text: "F1-Attention läuft dateidisjunkt daneben", source: "STAND.md#Nächster Griff" },
      { text: "F5: Policy, dann Persistenz", source: "STAND.md#Nächster Griff" },
    ],
    specs,
    pkgs,
  );
  const att = next.find((n) => /attention/i.test(n.doneWhen) || /attention/i.test(n.why));
  assert.ok(att);
  assert.equal(att.doneWhen, ".pa/task_f1_attention.md");
  const f5 = next.find((n) => /F5:/.test(n.why) || n.packet.startsWith("F5"));
  assert.equal(f5.startable, false, "F5 waits while F4 is waiting");
});

test("F3 packet mentioning F1-Codes maps to F3 not F1", () => {
  const pkgs = buildPackages("", [
    { file: ".pa/task_f3_attention.md", packet: "F3: Inbox + Notifications auf F1-Codes" },
    { file: ".pa/task_f2_kinds.md", packet: "F2: Queen-Sperre, F0-5 verdrahten" },
  ]);
  assert.equal(pkgs.find((p) => p.id === "F3").current, "active");
  assert.equal(pkgs.find((p) => p.id === "F1").current, "waiting");
  assert.equal(pkgs.find((p) => p.id === "F2").current, "active");
  assert.equal(pkgs.find((p) => p.id === "F0").current, "waiting");
});

test("F8 isolated grip binds task_f8.md", () => {
  const specs = [
    { file: ".pa/task_f8.md", packet: "F8: isolierte Belege", lane: "serial", serialOwner: "main.rs" },
  ];
  const next = buildNext(
    [{ text: "**F8 isoliert:** scripts/f8-isolated-proof.ps1", source: "STAND.md#Nächster Griff" }],
    specs,
    [],
  );
  assert.equal(next[0].doneWhen, ".pa/task_f8.md");
  assert.equal(next[0].serialOwner, "main.rs");
});

test("CLAIM continuation lines stay on the same finding", () => {
  const findings = parseFindings(FIND_FIXTURE);
  const nt5 = findings.find((f) => f.id === "NT-5/P2-D");
  assert.match(nt5.text, /zuverlässig/);
});

test("parseNextGrip copies Nächster Griff prose when §3 has no numbered list", () => {
  const stand = `## 3. Nächster Griff

F0-7 und F6-Suite sind auf main.

Nächster Griff: paketierte UI-Schritte des Golden Path (Projekt anlegen in der
isolierten App) und ein signed Updater-Relaunch.

### Aktive Specs
`;
  const items = parseNextGrip(stand);
  assert.equal(items.length, 1);
  assert.match(items[0].text, /Golden Path/);
  assert.match(items[0].text, /paketierte UI/);
  assert.equal(items[0].source, "STAND.md#Nächster Griff");
});

test("parseNextGrip reads the current §11 handoff prose", () => {
  const stand = `## 3. Nächster Griff

Nächste Griffe aus §11 des Plans: der zurückgestellte Merge-Tree-Runner,
sobald die Review-Evidence dafür bindet.

### Aktive Specs
`;
  const items = parseNextGrip(stand);
  assert.equal(items.length, 1);
  assert.match(items[0].text, /Merge-Tree-Runner/);
});

test("F0-Abnahme and F0-7 packets light F0; F6: lights F6-UI", () => {
  const pkgs = buildPackages("", [
    { file: ".pa/task_f0_db_fixtures.md", packet: "F0-Abnahme: Alt-DBs öffnen ohne Datenverlust" },
    { file: ".pa/task_f0_7.md", packet: "F0-7: Restore-Pfad für `.pre-migration-*.bak`" },
    { file: ".pa/task_f6_o0.md", packet: "F6: O-0 echte Router-Sonden" },
    { file: ".pa/task_f6_suite.md", packet: "F6: 20-Lauf-Suite + Cheap-vs-Reliable-Kosten" },
  ]);
  assert.equal(pkgs.find((p) => p.id === "F0").current, "active");
  assert.equal(pkgs.find((p) => p.id === "F6-UI").current, "active");
  assert.equal(pkgs.find((p) => p.id === "F6-Attribution").current, "waiting");
});

test("F0-7 FACT cites report_f0_7.md; keinen Rückweg is not restore evidence", () => {
  const stand = `## 4. Bewusst offene Produktbefunde

Neu aus F0, Beleg in \`.pa/report_f0.md\`:

- **F0-7: \`.pre-migration-*.bak\` hat keinen Rückweg.**
`;
  const claimOnly = parseFindings(stand, {
    reportF0: "Pre-Migration-Backups. `.pre-migration-*.bak` hat keinen Rückweg.\n",
    reportFiles: [{ path: ".pa/report_f0_db_fixtures.md", text: "keinen Rückweg in der Alt-DB.\n" }],
  });
  assert.equal(claimOnly.find((f) => f.id === "F0-7").klass, "CLAIM");
  assert.equal(claimOnly.find((f) => f.id === "F0-7").source, "STAND.md");

  const fact = parseFindings(stand, {
    reportF0: "restore-probe.sh sees no pa restore.\n",
    reportFiles: [
      { path: ".pa/report_f0.md", text: "Pre-Migration-Backups.\n" },
      { path: ".pa/report_f0_7.md", text: "restore-probe.sh + pa restore.\n" },
    ],
  });
  const f07 = fact.find((f) => f.id === "F0-7");
  assert.equal(f07.klass, "FACT");
  assert.equal(f07.source, ".pa/report_f0_7.md");
});

test("Golden Path prose grip binds task_f8.md", () => {
  const specs = [
    { file: ".pa/task_f8.md", packet: "F8: isolierte Belege", lane: "serial", serialOwner: "main.rs" },
  ];
  const next = buildNext(
    [
      {
        text: "paketierte UI-Schritte des Golden Path (Projekt anlegen in der isolierten App)",
        source: "STAND.md#Nächster Griff",
      },
    ],
    specs,
    [],
  );
  assert.equal(next[0].doneWhen, ".pa/task_f8.md");
});

test("spec startable: first serialOwner holder only", () => {
  const specs = applySpecStartable([
    { file: ".pa/task_f1_single_instance.md", packet: "F1", lane: "serial", serialOwner: "main.rs" },
    { file: ".pa/task_f1_diagnostics.md", packet: "F1", lane: "serial", serialOwner: "main.rs" },
    { file: ".pa/task_f4_persist.md", packet: "F4", lane: "serial", serialOwner: "store.rs" },
    { file: ".pa/task_f8.md", packet: "F8", lane: "serial", serialOwner: "main.rs" },
  ]);
  const main = specs.filter((s) => s.serialOwner === "main.rs");
  assert.equal(main.filter((s) => s.startable).length, 1);
  assert.equal(specs[0].startable, true);
  assert.equal(specs[1].startable, false);
  assert.equal(specs[2].startable, true);
  assert.equal(specs[3].startable, false);
});

test("missing STAND → exit 1 and no data.json", () => {
  const root = mkdtempSync(join(tmpdir(), "hq-"));
  mkdirSync(join(root, "docs", "dev-hq"), { recursive: true });
  const stale = join(root, "docs", "dev-hq", "data.json");
  writeFileSync(stale, '{"keep":true}');
  // Spawn CLI from worktree cwd; --root is only the fixture tree.
  const r = spawnSync(
    process.execPath,
    ["scripts/dev-hq.mjs", "--root", root, "--out", join(root, "docs", "dev-hq")],
    { encoding: "utf8" },
  );
  assert.notEqual(r.status, 0);
  assert.equal(JSON.parse(readFileSync(stale, "utf8")).keep, true);
  assert.equal(existsSync(join(root, "docs", "dev-hq", "data.js")), false);
});

// Excerpt of the real docs/PLAN.md structure: the M overview table (header "M",
// not "ID"), the lane legend, one table per "### M<n> — title" section, prose
// after a table, mixed Stand cells, and a later section with a table that must
// not be read.
const PLAN_FIXTURE = `
## Meilensteine

| M | Titel | Abnahme in Alltagssprache |
|---|---|---|
| M1 | Alles Laufende gelandet, App startbar | Keine offenen Paket-PRs. |

### M1 — Alles Laufende gelandet, App startbar

| ID | Paket | Gr. | Lane | Stand |
|---|---|---|---|---|
| W2-03 | Usage-/Billing-Collectors je **\`Adapter\`** | M | st | ✓ #140 |
| W1-05b | Sichere Cancel-Regel; erst st-Kind, dann api-Kind | M | st → api | ✓ #19 |

### M2 — Überblick und Setup

| ID | Paket | Gr. | Lane | Stand |
|---|---|---|---|---|
| PLAN-01 | Ein Plan, zehn Regeln | M | doc | dieses Paket |
| OPS-01 | Status und Tagesbericht per Skript | M | doc | PR #164 |
| CLEAN-02 | Stillgelegten Pfad löschen (a \\| b) | S | api → mn → wk | ✓ #25 |
| SETUP-14 | Nutzer: tote Keys | S | N | offen |

PC-Setup außerhalb des Repos: Backup mit Kopia.

### M3 — App im Alltag + Zwischenrelease v1.5.0-beta

| ID | Paket | Gr. | Lane | Stand |
|---|---|---|---|---|
| W2-10 | Live-HQ-Views | M | hqL | 10a ✓ #13, 10b ✓ #21, 10c offen |
| W1-18b | Probe Codex/OpenCode | S | wk + N | in Arbeit |
| R-1 | Zwischenrelease | S | N + doc | offen |

### Reihenfolge der seriellen Lanes (nach Meilensteinen)

| ID | Paket | Gr. | Lane | Stand |
|---|---|---|---|---|
| X-1 | not a milestone package | S | ci | offen |
`;

test("parseMilestones reads the M1-M3 tables of the real PLAN.md structure", () => {
  const ms = parseAll.parseMilestones(PLAN_FIXTURE);
  assert.deepEqual(ms.map((m) => m.id), ["M1", "M2", "M3"]);
  assert.equal(ms[0].title, "Alles Laufende gelandet, App startbar");
  assert.equal(ms[2].title, "App im Alltag + Zwischenrelease v1.5.0-beta");
  assert.deepEqual(ms.map((m) => [m.done, m.total]), [[2, 2], [1, 4], [0, 3]]);
  const row = (mid, id) => ms.find((m) => m.id === mid).packages.find((p) => p.id === id);
  assert.deepEqual(row("M1", "W1-05b"), {
    id: "W1-05b", title: "Sichere Cancel-Regel; erst st-Kind, dann api-Kind",
    size: "M", lane: "st → api", stand: "✓ #19", state: "done", prNumbers: [19],
  });
  assert.equal(row("M1", "W2-03").title, "Usage-/Billing-Collectors je Adapter", "inline markup (code ticks, bold) is dropped");
  assert.equal(row("M2", "PLAN-01").state, "in_progress");
  assert.equal(row("M2", "OPS-01").state, "pr");
  assert.deepEqual(row("M2", "OPS-01").prNumbers, [164]);
  assert.equal(row("M2", "CLEAN-02").state, "done");
  assert.equal(row("M2", "CLEAN-02").title, "Stillgelegten Pfad löschen (a | b)");
  assert.equal(row("M2", "SETUP-14").state, "open");
  assert.equal(row("M3", "W2-10").state, "in_progress", "some sub-packages merged, some open");
  assert.deepEqual(row("M3", "W2-10").prNumbers, [13, 21]);
  assert.equal(row("M3", "W1-18b").state, "in_progress");
  assert.equal(row("M3", "R-1").state, "open");
  assert.ok(!ms.some((m) => m.packages.some((p) => p.id === "X-1")), "later tables are not read");
});

test("parseMilestones handles Stand edge cases and adjacent tables", () => {
  const head = ["| ID | Paket | Gr. | Lane | Stand |", "|---|---|---|---|---|"];
  const plan = [
    "### M1 — Edge", "", ...head,
    "| A-1 | leer | S | doc |  |",
    "| A-2 | nur Haken | S | doc | ✓ |",
    "| A-3 | klein geschrieben | S | doc | pr #7 |",
    ...head,
    "| A-4 | angrenzende Tabelle | S | doc | offen |",
    "", "#### Unterabschnitt", "", ...head,
    "| B-1 | nicht gelesen | S | doc | offen |", "",
  ].join("\n");
  const [m] = parseAll.parseMilestones(plan);
  assert.deepEqual(
    m.packages.map((p) => [p.id, p.state]),
    [["A-1", "open"], ["A-2", "done"], ["A-3", "pr"], ["A-4", "open"]],
    "no header/separator pseudo-packages, no double reading, sub-heading ends the section",
  );
  assert.deepEqual([m.done, m.total], [1, 4]);
});

test("parseMilestones yields nothing when PLAN.md has no milestone sections", () => {
  assert.deepEqual(parseAll.parseMilestones("# Plan\n\n| ID | Paket |\n|---|---|\n| A | b |\n"), []);
});

test("dev-hq snapshot carries the PLAN.md milestones and no F-package DAG", () => {
  const root = mkdtempSync(join(tmpdir(), "hq-ms-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "STAND.md"), "# STAND\n\n## Aktive Specs\n\n| Spec | Paket | Lane |\n|---|---|---|\n");
  writeFileSync(join(root, "docs", "PLAN.md"), PLAN_FIXTURE);
  const out = join(root, "docs", "dev-hq");
  const r = spawnSync(process.execPath, ["scripts/dev-hq.mjs", "--root", root, "--out", out], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const data = JSON.parse(readFileSync(join(out, "data.json"), "utf8"));
  assert.deepEqual(data.milestones.map((m) => m.id), ["M1", "M2", "M3"]);
  assert.equal(data.milestones[1].done, 1);
  assert.equal(data.packages, undefined, "the F0-F8 DAG is no longer emitted");
  assert.match(readFileSync(join(out, "data.js"), "utf8"), /"milestones"/);
});
