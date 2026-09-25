// scripts/lib/active-specs.mjs
const ABSCHNITT = /^#{2,4}\s*Aktive Specs\s*$/;
// `aktiv` = ausführbar (muss in STAND.md gelistet sein), `historisch` =
// abgeschlossen, `entwurf` = in Arbeit am Text, noch kein Auftrag — ein
// Entwurf ist weder ausführbar noch abgeschlossen und blockiert niemanden
// (F4-Rest r24: task_f_core3_delivery.md legte den dritten Zustand an).
const ERLAUBT = new Set(["aktiv", "historisch", "entwurf"]);
const HEAD_LINES = 8;

export function listedInStand(standText) {
  const zeilen = standText.split(/\r?\n/);
  const start = zeilen.findIndex((z) => ABSCHNITT.test(z));
  if (start === -1) return { names: [], error: 'STAND.md: Abschnitt "Aktive Specs" fehlt.' };
  const names = [];
  for (const zeile of zeilen.slice(start + 1)) {
    if (/^#{1,4}\s/.test(zeile)) break;
    for (const [, datei] of zeile.matchAll(/`?\.pa\/(task_[A-Za-z0-9_.-]+\.md)`?/g)) {
      names.push(datei);
    }
  }
  return { names, error: null };
}

export function readSpecStatuses(files) {
  const status = {};
  const errors = [];
  for (const { name, head } of files) {
    const treffer = head.split(/\r?\n/).slice(0, HEAD_LINES).filter((z) => /^Status:/.test(z));
    if (treffer.length !== 1) {
      errors.push(`.pa/${name}: Status-Zeile ungueltig`);
      continue;
    }
    const wert = treffer[0].replace(/^Status:\s*/, "").trim();
    if (!ERLAUBT.has(wert)) {
      errors.push(`.pa/${name}: Status "${wert}" unbekannt`);
      continue;
    }
    status[name] = wert;
  }
  return { status, errors };
}

export function reconcile(status, listedNames) {
  const listed = new Set(listedNames);
  const executable = [];
  const warnings = [];
  const errors = [];
  for (const [name, wert] of Object.entries(status)) {
    if (wert === "aktiv" && !listed.has(name)) {
      const msg = `.pa/${name}: "Status: aktiv", aber nicht unter "Aktive Specs" in STAND.md gelistet.`;
      warnings.push(msg);
      errors.push(msg);
    }
  }
  for (const name of listedNames) {
    if (!status[name]) {
      const msg = `STAND.md listet .pa/${name} — Datei fehlt oder hat keinen gueltigen Status.`;
      warnings.push(msg);
      errors.push(msg);
    } else if (status[name] !== "aktiv") {
      const msg = `STAND.md listet .pa/${name} als ausfuehrbar, die Datei sagt aber "Status: ${status[name]}".`;
      warnings.push(msg);
      errors.push(msg);
    } else {
      executable.push(name);
    }
  }
  return { executable, warnings, errors };
}
