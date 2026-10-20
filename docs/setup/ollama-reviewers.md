# Ollama-Reviewerpaar (kimi-k3 + glm-5.2)

Transportbeispiel vom 25.09.–04.10.2026, kein festes Pflichtpaar oder heutiger
Zugangsbeleg. Aktuelle Reviewer: privater Koordinatornachweis. Die Stufen stehen in
`AGENTS.md`, Regel 5: Nahtstelle, Security, Nebenläufigkeit, PTY oder Datenbank
→ zwei verschiedene Nicht-Autorenfamilien; andere Rust-/TS-Pakete (B) ebenso,
regulär Abo + OpenRouter aus vorhandenem Guthaben. E1 (Elias, 20.10.2026): bei
OpenRouter-Guthaben <= 0 auch zwei Abo-Familien; kein Kauf, kostenlose Modelle
zählen nie als Pflichtreviewer. Doku, Tests, Snapshots und Konfiguration ohne
Laufzeitwirkung (C) → Gates; C+ (Skip/Timeout/Retry oder schwächere Assertions
in Tests) → ein Fremdreview. Ollama zählt nur über einen berechtigten Abo-Pfad.
Zurück zur Übersicht: [README.md](README.md).

## Voraussetzungen

- Ollama läuft lokal (`http://127.0.0.1:11434`), angemeldet bei Ollama Cloud:
  `ollama signin`.
- Die beiden Modelle sind vorhanden: `ollama list` zeigt `kimi-k3:cloud` und
  `glm-5.2:cloud`; `npm run dev:agent-check` prüft diese historischen Defaults.
  Fehlende Modelle sind keine Installationsfreigabe; keine Downloads ohne gültige Erlaubnis.
- `python` (3.x) für `.pa/review_transport.py`.
- Kein Key: der lokale Ollama-Endpunkt braucht keinen `REVIEWER_n_KEY`.

## Aufruf

`.pa/review_transport.py` wird nur über Umgebungsvariablen konfiguriert
(`REVIEWER_<n>_NAME`, `_KIND`, `_URL`, `_MODEL`, optional `_KEY`).
`REVIEW_DIR` bezeichnet ein privates Verzeichnis außerhalb des Repos:

```sh
export REVIEWER_1_NAME=kimi-k3 REVIEWER_1_KIND=ollama \
       REVIEWER_1_URL=http://127.0.0.1:11434/api/generate REVIEWER_1_MODEL=kimi-k3:cloud
export REVIEWER_2_NAME=glm-5.2 REVIEWER_2_KIND=ollama \
       REVIEWER_2_URL=http://127.0.0.1:11434/api/generate REVIEWER_2_MODEL=glm-5.2:cloud
python .pa/review_transport.py "$REVIEW_DIR/review_prompt_<label>.md" "$REVIEW_DIR" <label> --author "<Instanz>"
```

- Ergebnis im privaten Verzeichnis: `review_<label>_kimi-k3.md` und `review_<label>_glm-5.2.md`.
- **Exit 0 nur, wenn jeder Reviewer geantwortet hat.** Exit 1 = mindestens ein
  Reviewer ohne Urteil; Ausfall erst untersuchen, nicht als Review werten.

## Prompt

Ollama-Reviewer lesen **kein** `AGENTS.md` und keinen Code außerhalb des
Prompts. Die uncommittete Prompt-Datei außerhalb des Repos muss deshalb alles
enthalten:

1. Auftrag und Paket-ID, Kandidat-Commit.
2. Den vollständigen Diff bzw. die geänderten Dateien.
3. Die Regeln, gegen die geprüft wird (Auszug aus `AGENTS.md`: Beweismaßstab,
   Nahtstellen, keine Secrets, …).
4. Das gewünschte Ausgabeformat: Befunde mit ID, Schwere, Datei:Zeile,
   Begründung, Urteil (freigeben / freigeben mit Auflagen / ablehnen).

Den Prompt mit einem Skript zusammensetzen, nicht per Shell-Umleitung: ein
Hook-Ausgabe-Überschreiben hat schon einmal einen 238-Zeichen-Prompt erzeugt
(dieselbe Fehlerklasse wie `KI-21` in `KNOWN_ISSUES.md`). Antworten wie „keine
Frage erkannt" sind kein Review.

## Lokal reviewen

`scripts/review/run-local.sh` ist der Ein-Befehl-Weg ohne GitHub Actions
(keine CI-Minuten): Es baut den Prompt aus dem Diff und ruft den oben
beschriebenen `.pa/review_transport.py` auf, statt ihn nachzubauen.

```sh
bash scripts/review/run-local.sh 42 --out-dir "$REVIEW_DIR"       # PR #42 gegen origin/main
bash scripts/review/run-local.sh --out-dir "$REVIEW_DIR"          # aktueller Branch
bash scripts/review/run-local.sh 42 --via kilo --out-dir "$REVIEW_DIR" # nur ergänzend, kostenlos
bash scripts/review/run-local.sh --dry-run --out-dir "$REVIEW_DIR" # nichts senden
```

- `--via ollama` (Standard): die Modelle stehen in `REVIEWER_MODELS` in
  `scripts/dev/agent-setup-check.mjs` (`kimi-k3:cloud`, `glm-5.2:cloud`);
  ueberschreiben mit `--models a,b` oder `REVIEW_OLLAMA_MODELS`. Endpunkt ist
  `OLLAMA_HOST` (Standard: lokaler Ollama, kein Key). Nur wer direkt gegen
  `https://ollama.com` spricht, setzt `OLLAMA_API_KEY` in der Umgebung.
- `--via kilo`: `kilo run -m kilo/<modell>:free`, nur `:free`-Modelle (alles
  andere lehnt das Skript ab). Standard: `stepfun/step-3.7-flash:free` und
  `nvidia/nemotron-3-super-120b-a12b:free`; die Liste der kostenlosen Modelle
  aendert sich (`kilo models kilo | grep ':free'`), ueberschreiben mit
  `--models` oder `REVIEW_KILO_MODELS`. Beide Standardmodelle standen am
  26.09.2026 in `kilo models kilo`; veraltet ein Name, endet der Lauf mit
  `failed`, dann `--models` setzen. kilo laeuft als `--agent ask` (Schreiben
  verboten, keine Auto-Freigaben) in einem leeren Wegwerfverzeichnis und
  bekommt den Prompt als Anhang; Zeitlimit `REVIEW_KILO_TIMEOUT_S`
  (Standard 900 s, 0 = keins). Der Diff ist Eingabe eines Agenten mit
  Lesewerkzeugen: PRs unbekannter Herkunft nicht ueber `--via kilo` pruefen,
  dort ist der Ollama-Weg (reine Textanfrage, keine Werkzeuge) der sichere.
- Ohne `--out-dir` schreibt das Skript nach `.pa/`; deshalb immer ein privates
  Verzeichnis außerhalb des Repos angeben. Prompt/Antworten nicht committen.
  `<label>` = `pr<N>` oder Branchname (`/` wird `-`), mit `--label` umlenkbar.
- Exit 0 nur, wenn jeder Reviewer Text geliefert hat; Exit 1 bei leerer oder
  fehlerhafter Antwort (Protokoll `Status: failed`, Ursache untersuchen);
  Exit 2 bei Aufruf- oder Voraussetzungsfehlern (fehlendes Ollama, kilo oder
  Key, unbekannter PR, kein Diff, Diff ueber `REVIEW_MAX_DIFF_CHARS`, zwei
  Modelle mit demselben Protokollnamen). Ein abgeschnittener Diff waere kein
  Review; deshalb wird nichts gekuerzt.
- Der Protokollname kommt aus dem Modell: `:cloud` faellt weg, jeder andere Tag
  wird zum Bindestrich (`llama3:8b` → `llama3-8b`), kilo nimmt nur das letzte
  Pfadelement ohne `:free`. Zwei Modelle, die daraus denselben Namen machen,
  lehnt das Skript ab (`llama3:8b` neben `llama3-8b`, `a/x:free` neben
  `b/x:free`): sie wuerden einander das Protokoll ueberschreiben, und der Lauf
  meldete trotzdem zweimal „ok“ — ein Dual-Review, den es als Datei nicht gibt.
  Groß-/Kleinschreibung zählt mit (NTFS und APFS sind nicht case-sensitiv),
  und ein Modellname außerhalb `A-Za-z0-9 . _ : / -` wird ebenfalls abgelehnt:
  die Umschreibung ins Dateinamenschema ist sonst byteweise (tr) gegenüber
  zeichenweise (slug im Transport) und damit nicht eindeutig. Die Prüfung gilt
  auch für `--dry-run` — ein Aufruf, der so nicht sendbar wäre, wird auch beim Prompt-Bauen abgelehnt.
- Geprueft werden nur **committete** Aenderungen. Der Diff geht an den
  gewaehlten Dienst: nichts Vertrauliches im Branch.
- Selbsttest ohne Netz: `bash scripts/test-review-local.sh` (Fake-Ollama,
  kilo-Stub, Wegwerf-Repo).

## Disposition

Jeder Befund bekommt eine Zeile im PR-Text (AGENTS.md Regel 7):
ID, Quelle, Schwere, Befund, Disposition (angenommen mit Commit / abgelehnt mit
Grund / Folgearbeit). Historische Vorlage: `.pa/review_setup-09_disposition.md`. Ändert sich
der Kandidat danach, wird das Delta erneut geprüft.

## Reviewer oder Advisor?

Ollama ist ein möglicher Transport, keine Review-Zulassung. Textlieferung und
`accept-check.mjs` beweisen weder B=2/C+=1 noch Autoren-/Zahlungsberechtigung;
der Koordinator prüft diese Regeln zusätzlich, bis die Checker-Lücken behoben sind.
Für harte Entscheidungen und Abschlussreviews gelten die Advisor-Regeln (siehe
[README.md](README.md#advisors)). Der frühere Workflow `.github/workflows/review.yml` (OpenRouter) ist am
25.09.2026 gelöscht (PLAN-01); OpenRouter-Reviews sind aus vorhandenem Guthaben
erlaubt, ohne Kauf oder Auto-Reload (AGENTS.md, Regel 5 und E1).
