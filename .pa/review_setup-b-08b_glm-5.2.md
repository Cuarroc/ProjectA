# Review: pr153 — glm-5.2

- Autor des Artefakts: Claude (PR #153, nur SETUP-08b)
- Reviewer: glm-5.2 (ollama @ http://127.0.0.1:11434/api/generate), angefragtes Modell `glm-5.2:cloud`, bedient `glm-5.2`
- Datum: 2026-09-25 02:00 UTC, Dauer 192 s, Status: ok
- Unabhaengigkeit: Reviewer hatte keinen Anteil am Artefakt (M2)
- Prompt: `review_prompt_pr153.md` (57521 Zeichen)

## Roh-Urteil des Reviewers

## Review: SETUP-08b (Plan-/Spec-Helfer unter scripts/dev)

Ich habe den Diff Commits `e7b63e8` + `273453f` geprüft. Im Folgenden die Befunde.

---

**Keine blocking-Befunde gefunden.**

---

### Befunde

**1. medium — `scripts/dev/hygiene.mjs`:114 — git-fetch-Fehler nicht fail-closed**

```js
if (f.code !== 0) io.err(`Hinweis: git fetch fehlgeschlagen, …\n`);
```

Wenn `git fetch --prune origin` fehlschlägt (Netzwerk, Auth, etc.), wird nur eine Warnung auf stderr ausgegeben, dann aber mit den veralteten Remote-Tracking-Refs weitergerechnet. Das kann zu falschen Befunden führen: Branches, die längst gemergt und remote gelöscht wurden, erscheinen als „nicht in main, prüfen"; PRs, die zwischenzeitlich geschlossen wurden, erscheinen noch als offen.

**Fehlerszenario:** Agent führt `hygiene --strict` ohne Netzwerk aus → veralteter Stand → Exit 1 mit falschen Befunden → Agent glaubt, es gäbe verwaiste Branches, und löscht sie.

**Fix-Vorschlag:** Bei Fetch-Fehler ohne `--no-fetch` Exit 3 (REFUSED) zurückgeben, oder zumindest `--strict` überspringen. Alternativ einen `fetchOk`-Flag in die Daten aufnehmen und im Bericht prominent ausweisen.

---

**2. medium — `scripts/dev/pr-status.mjs`:17-21 — Required-Checks hartkodiert, potentiell abweichend von `gates.sh`**

```js
export const REQUIRED = [
  ["linux", "gates (linux)"],
  ["windows", "gates (windows)"],
  ["redFirst", "red-first"],
];
```

Die Check-Namen sind hier dupliziert. Wenn `scripts/ci/gates.sh` die Required-Checks ändert ( Umbenennung, neues Gate, Wegfall eines Gates), zeigt `pr-status` veraltete/fehlerhafte Spalten — ein Agent könnte einen grünen PR fälschlich als „wartet auf CI" oder „rot" einstufen. Dies ist kein Gate-Verstoß gegen AGENTS.md (das Array ist eine Anzeige, keine Durchsetzung), aber eine Wartbarkeits- und Korrektheitsfalle.

**Fehlerszenario:** `gates.sh` benennt „gates (linux)" in „ci/linux" um → `pr-status` zeigt für jeden PR „—" in der Linux-Spalte → „bereit"-Logik greift nie, weil `states.every(s => s === "ok" || s === "übersprungen")` niemals erfüllt ist.

**Fix-Vorschlag:** Entweder die Check-Namen aus einer gemeinsamen Konstante/Datei importieren (die auch `gates.sh` nutzt), oder im README/deutlich im Code kommentieren, dass diese Liste manuell synchron zu halten ist und bei Abweichung `pr-status` falsch anzeigt.

---

**3. low — `scripts/dev/hygiene.mjs`:163 — ungetrackte Dateien mit Nicht-ASCII-Namen werden nicht entschärft**

```js
.map((l) => l.slice(3).replace(/^"(.*)"$/, "$1"));
```

Git porcelain (`core.quotePath = true`, Default) escaped Nicht-ASCII-Zeichen in Anführungszeichen als oktale Sequenzen (z. B. `"M\303\266bel.md"`). Der Code entfernt nur die umschließenden Quotes, lässt aber die `\303\266`-Escapes stehen. Die Ausgabe zeigt dann eine kaputte Dateiname.

**Fehlerszenario:** Datei `Möbel.md` ist ungetrackt → Hygiene-Bericht zeigt `M\303\266bel.md` → Agent versucht, diese Datei zu finden/zu löschen, scheitert.

**Fix-Vorschlag:** Wenn der Pfad gequotet ist, zusätzlich `\xxx`-Sequenzen dekodieren (z. B. mit `Buffer.from(p, 'latin1').toString('utf8')` nach Entfernen der Quotes), oder `git -c core.quotePath=false status` aufrufen.

---

**4. low — `scripts/dev/erledigt-row.mjs`:68-69 und `scripts/dev/spec-close.mjs`:53-54 — Zeilenende-Normalisierung bei gemischten EOLs**

Beide Helfer erkennen das dominante EOL (`\r\n` oder `\n`) und joinen *alle* Zeilen mit diesem einen Typ. Wenn eine Datei gemischte EOLs hat (z. B. CRLF-Tabelle, aber LF-Abschnitt davor/danach), werden alle Zeilen auf einen Typ normalisiert, was zu unerwarteten Diff-Hunks führt.

**Fehlerszenario:** `ERLEDIGT.md` hat LF in der Präambel und CRLF in der Tabelle → `erledigt-row --apply` schreibt die gesamte Datei mit LF → Diff zeigt jede Präambelzeile als geändert.

**Fix-Vorschlag:** Nur die geänderte Zeile mit ihrem ursprünglichen EOL schreiben (zeilenweises Patching) oder zumindest im Dry-Run warnen, wenn gemischte EOLs erkannt werden. Angesichts der Tatsache, dass diese Dateien vermutlich einheitliche EOLs haben, ist dies niedrig priorisiert.

---

**5. low — `scripts/dev/erledigt-row.mjs`:46 — `--title ""` wird ignoriert**

```js
return `| … | ${esc(title || cleanTitle(pr.title, id))} | …`;
```

Wenn ein Benutzer `--title ""` übergibt (explizit leerer Titel), wertet `"" || cleanTitle(…)` den linken Operanden als falsy und verwendet den PR-Titel. Die Absicht des Benutzers wird stillschweigend übergangen.

**Fehlerszenario:** Koordinator möchte bewusst einen leeren Titel setzen (z. B. weil der Titel im PR falsch ist und die Zeile später manuell bearbeitet wird) → `--title ""` → Helfer verwendet trotzdem den PR-Titel.

**Fix-Vorschlag:** `title !== undefined ? title : cleanTitle(…)` statt `title || cleanTitle(…)`.

---

**6. low — Testabdeckung: fehlende Fehlerfall-Tests**

- `erledigt-row`: kein Test für „Tabelle nicht gefunden" (RefusedError aus `insertRow`), kein Test für „Datei fehlt mit `--apply`", kein Test für gh-Netzwerkfehler (nur PR-not-merged getestet).
- `spec-close`: kein Test für „Spec ist schon historisch und nicht gelistet" (der `!spec.changed && !stand.removed.length`-Pfad), kein Test für „STAND.md fehlt".
- `hygiene`: kein Test für gh-Fehler während `gather` (nur git-Fetch-Warnung wird implizit durch `--no-fetch` umgangen).

**Fehlerszenario:** Ein Refactoring bricht die „Tabelle nicht gefunden"-Prüfung in `insertRow` → Tests bleiben grün → Helfer schreibt eine Zeile an eine falsche Position.

**Fix-Vorschlag:** Für die genannten Fehlerpfade jeweils einen Test hinzufügen, der den erwarteten Exit-Code (3) und die Fehlermeldung prüft.

---

### Korrektheit der.rot→grün-Logik

Der Commit `e7b63e8` (Tests, rot) kommt vor `273453f` (Implementierung, grün) im Diff. Die Tests testen überwiegend exportierte Pure Functions (`makeRow`, `insertRow`, `closeSpec`, `removeFromStand`, `checkState`, `buildRows`, `collectHygiene`, etc.) und nicht nur sich selbst. Die CLI-Tests verwenden Fake-`run`-Funktionen und testen Exit-Codes. Der `gather`-Test in `hygiene` prüft zusätzlich, dass keine Schreibbefehle (`push`, `commit`, `checkout`, …) aufgerufen werden — das ist eine gute Sicherheitsprüfung. Die Tests sind angemessen.

### Sicherheitsprüfung

- **Shell-Injection:** Alle `git`/`gh`-Aufrufe verwenden Array-Argumente (über `run`/`gitIn`), keine Shell-Strings. PR-Nummern werden gegen `^\d+$` validiert, Spec-IDs gegen ein strenges Regex. Keine Injection möglich. ✓
- **Pfad-Ausbruch:** `specName` validiert gegen `/^[A-Za-z0-9][A-Za-z0-9_.-]*$/` — kein `..` möglich. `erledigt-row` nutzt `resolve()` für `--file`, aber das ist eine explizite Option für den Koordinator. ✓
- **Credentials/Token:** Keine Token werden geloggt. `gh` wird als Array aufgerufen; stderr von gh wird nur bei Fehler als RefusedError-Nachricht weitergereicht. Wenn gh einen Token in stderr ausgibt (unwahrscheinlich), würde er in der Fehlermeldung landen — aber das ist gh's Verhalten, nicht das des Helfers. ✓
- **Unerwünschtes Committen/Pushen:** Keiner der vier Helfer ruft `git commit`, `git push`, `git merge`, etc. auf. `hygiene` macht nur `git fetch --prune` (Remote-Tracking-Refs) und Lesezugriffe. ✓
- **`--no-verify`-Äquivalent:** Nicht vorhanden. Kein Helfer umgeht Hooks oder Gates. ✓
- **AGENTS.md-Gate-Duplikation:** `pr-status.mjs` hat eine Anzeige-Liste von Check-Namen (Befund 2), aber keine Gate-Logik. `hygiene.mjs` dupliziert keine Gate-Liste. ✓

### Randfälle

- **Mehrere Specs/kein Treffer:** `spec-close` validiert nach dem Austragen mit `listedInStand`, ob die Spec noch gelistet ist → fail-closed. `erledigt-row` ist idempotent für gleiche PR+ID. `hygiene` meldet mehrere Specs korrekt. ✓
- **Bestehende ERLEDIGT-Zeile:** Idempotenz-Check vergleicht PR-Link und ID-Spalte. ✓
- **Sonderzeichen in Pfaden:** Spec-Namen sind streng validiert. `--file`/`--root` sind explizite Optionen. ✓
- **Aufruf aus Unterverzeichnis:** `gitIn(run, process.cwd())("rev-parse", "--show-toplevel")` findet die Repo-Wurzel. Falls das fehlschlägt (kein Git-Repo), fällt es auf `process.cwd()` zurück. ✓
- **Windows-Pfade:** `specName` akzeptiert sowohl `/` als auch `\` (`.replace(/^\.pa[\\/]/, "")`). EOL-Erkennung für CRLF ist vorhanden. ✓

---

### Gesamturteil

**mergebar: ja**

Die Helfer sind solide implementiert: fail-closed bei unerwarteten Zuständen, keine Shell-Injection-Vektoren, keine Gate-Umgehung, idempotente Schreiboperationen mit Dry-Run-Default. Die zwei medium-Befunde (Fetch-Fehler nicht fail-closed, hartkodierte Check-Namen) sollten idealerweise vor dem Merge adressiert werden, sind aber nicht blocking — beide führen zu falschen Hinweisen, nicht zu Datenkorruption oder Sicherheitsproblemen.
