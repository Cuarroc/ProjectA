# Review: sec-gitleaks — deepseek-v4-flash

- Autor des Artefakts: sec-gitleaks-precommit (kimi)
- Reviewer: deepseek-v4-flash (ollama @ http://127.0.0.1:11434/api/generate), angefragtes Modell `deepseek-v4-flash:cloud`, bedient `deepseek-v4-flash`
- Datum: 2026-09-25 04:18 UTC, Dauer 46 s, Status: ok
- Unabhaengigkeit: Reviewer hatte keinen Anteil am Artefakt (M2)
- Prompt: `review_prompt_sec-gitleaks.md` (18135 Zeichen)

## Roh-Urteil des Reviewers

URTEIL: annehmen mit Auflagen

BEGRÜNDUNG: Der Branch führt ein sinnvolles Pflicht-Gate für Geheimnis-Scans ein, das fail-closed arbeitet und mit einem Selbsttest die wesentlichen Richtungen (Positiv-, Negativ-, Leer-, Fehlkonfigurationsfall) abdeckt. Die Allowlist ist bewusst eng gefasst und adressiert präzise die bekannten Testwerte. Allerdings ist der Selbsttest unvollständig: Er prüft nur 4 der 9 Allowlist-Regexes und lässt damit die übrigen Kanarienvögel ungetestet, was zukünftige Fehlalarme übersehen könnte. Zudem ist die PATH-Filterung in Testfall 4 nicht robust gegenüber mehrfachen gitleaks-Installationen. Die Umgehung durch `git commit --no-verify` ist als lokales Gate akzeptabel, sollte aber als bewusstes Risiko dokumentiert bleiben.

BEFUNDE:
### S-01 — Selbsttest deckt nicht alle Allowlist-Einträge ab / mittel / Der Test in `scripts/test-secret-scan.sh` (Fall 2) enthält nur 4 der 9 in `.gitleaks.toml` definierten Regexes als Kanarienvögel. Dadurch wird nicht verifiziert, dass alle bekannten Testwerte (z.B. `deadbeefcafebabe0123456789abcdef`, `(kimi|opencode)-delivery-nt17`, `sk-abcdefghijklmnopqrst`, `sk-(or|test)-test-placeholder`) den Scan nicht auslösen. / Beleg: `scripts/test-secret-scan.sh:66-74` vs. `.gitleaks.toml:14-33` / Vorschlag: Jede Regex aus der Allowlist als Kanarienvogel in den Test aufnehmen und Exit 0 verlangen.
### S-02 — Allowlist-Regex `AKIACANARY[0-9A-Z]{12}` kann echte AWS-Keys maskieren / niedrig / Ein echter AWS Access Key, der zufällig mit `AKIACANARY` beginnt, würde durch diese Regel maskiert. Die Wahrscheinlichkeit ist extrem gering, aber nicht null. / Beleg: `.gitleaks.toml:24` / Vorschlag: Akzeptabel, da sehr spezifisch; alternativ exakt auf den bekannten Testwert verankern (z.B. `AKIACANARY123456789012`).
### S-03 — PATH-Filterung in Testfall 4 unvollständig / niedrig / `grep -vxF "$gl_dir"` entfernt nur das Verzeichnis, das `command -v gitleaks` zuerst liefert. Wenn gitleaks in mehreren PATH-Verzeichnissen installiert ist, wird die zweite Instanz nicht gefiltert, und der Test würde fälschlich Exit 2 erhalten. / Beleg: `scripts/test-secret-scan.sh:112` / Vorschlag: Alle Verzeichnisse mit gitleaks-Binary entfernen oder auf `PATH` komplett zurücksetzen und gitleaks separat hinzufügen.
### S-04 — `doctor.sh` überschreibt `urteil` bei mehreren fehlenden Gates / niedrig / In `scripts/ci/doctor.sh` setzt jede Gate-Prüfung `urteil` ersatzlos; wenn zwei erforderliche Werkzeuge fehlen, wird nur das zuletzt geprüfte gemeldet. Dies ist ein vorbestehendes Muster, das durch den Branch nicht behoben wird, aber durch das neue gitleaks-Gate verstärkt wird. / Beleg: `scripts/ci/doctor.sh:149` / Vorschlag: `urteil` als Liste führen oder anhängen, um alle fehlenden Werkzeuge zu melden.
### S-05 — Umgehung durch `git commit --no-verify` möglich / mittel / Das Gate ist nur lokal implementiert und kann mit `--no-verify` umgangen werden. Dies ist als Nutzer-Regel dokumentiert und für ein lokales Sicherheits-Gate ein akzeptables Restrisiko, aber eine server-seitige Durchsetzung (z.B. im CI-Push) würde die Lücke schließen. / Beleg: `docs/decisions.md` (Nutzer-Regel 25.09.) / Vorschlag: Als bewusstes Risiko in den Entscheidungen belassen; zukünftiger CI-Vollscan als separater Auftrag erwägen.

## Was trägt (max. 5)
- Dass der Scan nur den Index prüft und dadurch schnell ist – gut für die lokale Bahn.
- Fail-closed ohne gitleaks (Exit 2 mit Installationshinweis) – verhindert stillen Rückfall.
- Eng gefasste Allowlist mit dokumentierten Quellen – minimiert Fehlalarme.
- Selbsttest mit Positiv- und Negativkontrolle sowie Testfall für fehlendes Werkzeug – belegt Funktionsfähigkeit.
- Gutes Zusammenspiel mit doctor.sh und der Gate-Architektur – zeigt, dass das neue Gate integriert ist.
