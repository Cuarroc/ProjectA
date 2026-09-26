# Review: sec-gitleaks — glm-5.2

- Autor des Artefakts: sec-gitleaks-precommit (kimi)
- Reviewer: glm-5.2 (ollama @ http://127.0.0.1:11434/api/generate), angefragtes Modell `glm-5.2:cloud`, bedient `glm-5.2`
- Datum: 2026-09-25 04:17 UTC, Dauer 78 s, Status: ok
- Unabhaengigkeit: Reviewer hatte keinen Anteil am Artefakt (M2)
- Prompt: `review_prompt_sec-gitleaks.md` (18135 Zeichen)

## Roh-Urteil des Reviewers

URTEIL: annehmen mit Auflagen

BEGRÜNDUNG: Die Implementierung ist solide: gitleaks läuft fail-closed (Exit 2 bei fehlendem Binary, kein stiller Rückfall), die Allowlist-Regexes sind eng genug, um echte Geheimnisse nicht versehentlich durchzulassen, und der Selbsttest prüft Positiv- und Negativkontrolle gegen die echte `.gitleaks.toml` in einem Wegwerf-Repo. Das Test-Geheimnis in Fall 1 wird aus Teilstücken zusammengesetzt, was das Selbstauslöschungs-Problem elegant löst. Zwei Auflagen bleiben: der Selbsttest deckt nicht alle Allowlist-Einträge ab (Fall 2 lässt `ghp_B{16,}` und `sk-(or|test)-test-placeholder` ungetestet), und die PATH-Filterung in Fall 4 ist unzuverlässig, wenn gitleaks in mehreren Verzeichnissen liegt. Beides ist beherrschbar und blockiert nicht.

BEFUNDE:

### S-01 — Allowlist-Einträge ohne Testabdeckung / niedrig / Die Allowlist enthält `ghp_B{16,}` und `sk-(or|test)-test-placeholder`, die in Fall 2 des Selbsttests nicht geprüft werden. Wenn diese Werte im Repo vorkommen, fehlt die Negativkontrolle — der Selbsttest beweist dann nicht, dass sie passieren. Wenn sie nicht im Repo stehen, sind sie tote Einträge, die künftig verwirren. / `.gitleaks.toml:21,34`; `scripts/test-secret-scan.sh:69-80` / Vorschlag: Entsprechende Kanarienvögel in Fall 2 aufnehmen (`ghp_BBBB…`, `sk-test-test-placeholder`) oder Allowlist-Einträge entfernen, falls ungenutzt.

### S-02 — PATH-Filterung in Fall 4 unzuverlässig / niedrig / `command -v gitleaks` liefert nur den ersten Treffer aus PATH. Liegt gitleaks zusätzlich in einem anderen Verzeichnis, bleibt es nach Filterung des einen `gl_dir` weiterhin gefunden — der Test läuft dann grün durch, ohne "fehlendes gitleaks" tatsächlich geprüft zu haben. / `scripts/test-secret-scan.sh:99-100` / Vorschlag: Alle PATH-Einträge filtern, die eine `gitleaks`-Binärdatei enthalten, z. B. mit einer Schleife über `which -a gitleaks` (oder `command -v` iterativ), oder stattdessen `PATH=/usr/bin:/bin` setzen und prüfen, dass gitleaks dort nicht liegt.

### S-03 — `set -uo pipefail` ohne `-e` / info / Das Skript hat nur drei Befehle vor `exec`, und die kritischen sind mit `|| exit 1` bzw. im `if` abgesichert. Ein künftiges Hinzufügen von Befehlen könnte aber unbemerkt scheitern, ohne dass das Gate rot wird. / `scripts/ci/secret-scan.sh:14` / Vorschlag: `set -euo pipefail` oder Kommentar, warum `-e` bewusst fehlt.

## Was trägt

1. **Fail-closed konsequent umgesetzt** — `secret-scan.sh` prüft `command -v gitleaks`, bricht mit Exit 2 und Installationshinweis ab; `doctor.sh` blockiert die Bahnen `precommit` und `prepush`, wenn gitleaks fehlt.
2. **Allowlist eng gefasst** — Muster wie `AKIAC{16}` (AKIA + genau 16× C) oder `sk-ant-api03-A{16,}` matchen nur die Test-Kanarienvögel, nicht echte AWS- oder Anthropic-Keys; `AKIACANARY[0-9A-Z]{12}` kann aufgrund der Länge (22 statt 20 Zeichen) keine echten AWS-Keys schlucken.
3. **Selbsttest mit echter Konfiguration** — Kopiert `secret-scan.sh` und `.gitleaks.toml` in ein Wegwerf-Repo, testet also die ausgelieferte Konfiguration, nicht eine abweichende Kopie.
4. **Test-Geheimnis stückweise zusammengesetzt** — `fake="ghp_""x7Kq9Mz2"…` verhindert, dass das eigene Gate den Commit des Selbsttests blockiert; gleichzeitig wird der Default-Regel-Satz (GitHub-PAT) scharf geprüft.
5. **Entscheidung sauber dokumentiert** — `docs/decisions.md` nennt Regel, Begründung (Prüfung E: 36 Treffer, alle Testwerte), Rücknahme-Kriterium und bewussten Verzicht auf CI-Vollscan.
