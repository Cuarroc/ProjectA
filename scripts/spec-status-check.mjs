#!/usr/bin/env node
// Spec-Status-Gate (Sanierungsplan Rev 9, F0).
//
// Der Plan sagt: "Nur eine in STAND.md ausdruecklich unter 'aktive Specs'
// gelistete Datei mit `Status: aktiv` ist ausfuehrbar." Das war bis F0 eine
// Konvention, an die sich niemand halten musste — 77 Rev-8-Specs lagen ohne
// jede Statuszeile in `.pa/` und lasen sich alle wie ein gueltiger Auftrag.
// Dieses Gate macht die Regel pruefbar: Status-Zeile Pflicht, `aktiv` nur mit
// Eintrag in STAND.md, Eintrag in STAND.md nur mit existierender aktiver Datei.
//
// Exit 0 = sauber, Exit 1 = Verstoss (Ausgabe nennt Datei und Grund).

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { listedInStand, readSpecStatuses, reconcile } from "./lib/active-specs.mjs";

const SPEC_DIR = ".pa";
const STAND = "STAND.md";

if (!existsSync(SPEC_DIR)) {
  console.error(`FEHLER: ${SPEC_DIR}/ fehlt.`);
  process.exit(1);
}

const files = readdirSync(SPEC_DIR)
  .filter((n) => /^task_.*\.md$/.test(n))
  .sort()
  .map((name) => ({
    name,
    head: readFileSync(join(SPEC_DIR, name), "utf8"),
  }));

const { status, errors: statusErrors } = readSpecStatuses(files);
const fehler = [...statusErrors];

if (!existsSync(STAND)) {
  fehler.push(`${STAND} fehlt — das Gate braucht die Liste der aktiven Specs.`);
} else {
  const stand = listedInStand(readFileSync(STAND, "utf8"));
  if (stand.error) fehler.push(stand.error);
  const r = reconcile(status, stand.names);
  fehler.push(...r.errors);
}

if (fehler.length > 0) {
  console.error("Spec-Status-Gate: FEHLGESCHLAGEN\n");
  for (const z of [...new Set(fehler)]) console.error(`  - ${z}`);
  console.error(`\n${fehler.length} Verstoss/Verstoesse.`);
  process.exit(1);
}

const aktive = Object.entries(status).filter(([, w]) => w === "aktiv");
console.log(
  `Spec-Status-Gate: OK — ${Object.keys(status).length} Specs, ${aktive.length} aktiv` +
    (aktive.length > 0 ? ` (${aktive.map(([n]) => n).join(", ")})` : "") +
    `, ${Object.keys(status).length - aktive.length} historisch.`,
);
