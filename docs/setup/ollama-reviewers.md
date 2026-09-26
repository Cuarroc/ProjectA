# Ollama-Reviewerpaar (kimi-k3 + glm-5.2)

Rolle: das Alltags-Reviewerpaar für Pläne und Diffs (Regel in `AGENTS.md`:
über 300 Zeilen oder Nahtstelle → zwei Reviews anderer Anbieter vor dem Merge).
Zurück zur Übersicht: [README.md](README.md).

## Voraussetzungen

- Ollama läuft lokal (`http://127.0.0.1:11434`), angemeldet bei Ollama Cloud:
  `ollama signin`.
- Die beiden Modelle sind vorhanden: `ollama list` zeigt `kimi-k3:cloud` und
  `glm-5.2:cloud` (sonst `ollama pull <modell>`). `npm run dev:agent-check`
  prüft das.
- `python` (3.x) für `.pa/review_transport.py`.
- Kein Key: der lokale Ollama-Endpunkt braucht keinen `REVIEWER_n_KEY`.

## Aufruf

`.pa/review_transport.py` wird nur über Umgebungsvariablen konfiguriert
(`REVIEWER_<n>_NAME`, `_KIND`, `_URL`, `_MODEL`, optional `_KEY`):

```sh
export REVIEWER_1_NAME=kimi-k3 REVIEWER_1_KIND=ollama \
       REVIEWER_1_URL=http://127.0.0.1:11434/api/generate REVIEWER_1_MODEL=kimi-k3:cloud
export REVIEWER_2_NAME=glm-5.2 REVIEWER_2_KIND=ollama \
       REVIEWER_2_URL=http://127.0.0.1:11434/api/generate REVIEWER_2_MODEL=glm-5.2:cloud
python .pa/review_transport.py .pa/review_prompt_<label>.md .pa <label> --author "<Instanz>"
```

- Ergebnis: `.pa/review_<label>_kimi-k3.md` und `.pa/review_<label>_glm-5.2.md`.
- **Exit 0 nur, wenn jeder Reviewer geantwortet hat.** Exit 1 = mindestens ein
  Reviewer ohne Urteil; das Protokoll hält den Ausfall fest. Nochmals laufen
  lassen, nicht als Review werten.

## Prompt

Ollama-Reviewer lesen **kein** `AGENTS.md` und keinen Code außerhalb des
Prompts. Die Prompt-Datei `.pa/review_prompt_<label>.md` muss deshalb alles
enthalten:

1. Auftrag und Paket-ID, Kandidat-Commit.
2. Den vollständigen Diff bzw. die geänderten Dateien.
3. Die Regeln, gegen die geprüft wird (Auszug aus `AGENTS.md`: Beweismaßstab,
   Nahtstellen, keine Secrets, …).
4. Das gewünschte Ausgabeformat: Befunde mit ID, Schwere, Datei:Zeile,
   Begründung, Urteil (freigeben / freigeben mit Auflagen / ablehnen).

Den Prompt mit einem Skript zusammensetzen, nicht per Shell-Umleitung: ein
Hook-Ausgabe-Überschreiben hat schon einmal einen 238-Zeichen-Prompt erzeugt
(`.pa/review_w2-02_disposition.md`). Antworten wie „keine Frage erkannt" sind
kein Review.

## Lokal reviewen

`scripts/review/run-local.sh` ist der Ein-Befehl-Weg ohne GitHub Actions
(keine CI-Minuten): Es baut den Prompt aus dem Diff und ruft den oben
beschriebenen `.pa/review_transport.py` auf, statt ihn nachzubauen.

```sh
bash scripts/review/run-local.sh 42                  # PR #42 (origin pull/42/head) gegen origin/main
bash scripts/review/run-local.sh                     # aktueller Branch gegen origin/main
bash scripts/review/run-local.sh 42 --via kilo       # kostenlose Modelle ueber die kilo-CLI
bash scripts/review/run-local.sh --dry-run           # nur den Prompt bauen, nichts senden
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
  `--models` oder `REVIEW_KILO_MODELS`. kilo laeuft in einem leeren
  Wegwerfverzeichnis und bekommt den Prompt als Anhang.
- Ergebnis: `.pa/review_prompt_<label>.md` und `.pa/review_<label>_<modell>.md`,
  `<label>` = `pr<N>` oder der Branchname (`/` wird `-`). Mit `--out-dir` und
  `--label` umlenkbar.
- Exit 0 nur, wenn jeder Reviewer Text geliefert hat; Exit 1 bei leerer oder
  fehlerhafter Antwort (Protokoll `Status: failed`, nochmals laufen lassen);
  Exit 2 bei Aufruf- oder Voraussetzungsfehlern (fehlendes Ollama, kilo oder
  Key, unbekannter PR, kein Diff, Diff ueber `REVIEW_MAX_DIFF_CHARS`).
  Ein abgeschnittener Diff waere kein Review; deshalb wird nichts gekuerzt.
- Geprueft werden nur **committete** Aenderungen. Der Diff geht an den
  gewaehlten Dienst: nichts Vertrauliches im Branch.
- Selbsttest ohne Netz: `bash scripts/test-review-local.sh` (Fake-Ollama,
  kilo-Stub, Wegwerf-Repo).

## Disposition

Jeder Befund bekommt eine Zeile in `.pa/review_<label>_disposition.md`:
ID, Quelle, Schwere, Befund, Disposition (angenommen mit Commit / abgelehnt mit
Grund / Folgearbeit). Vorlage: `.pa/review_w2-02_disposition.md`. Ändert sich
der Kandidat danach, wird das Delta erneut geprüft.

## Reviewer oder Advisor?

Das Ollama-Paar prüft Diffs und Pläne im Alltag. Für harte Entscheidungen und
Abschlussreviews gilt das Advisor-Paar Fable 5.1 + GPT-6 Astra (siehe
[README.md](README.md#advisors)). Der frühere Workflow `.github/workflows/review.yml` (OpenRouter) ist am
25.09.2026 gelöscht (PLAN-01); OpenRouter wird nicht mehr benutzt.
