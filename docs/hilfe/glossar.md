# Glossar — 30 Begriffe in einfachen Worten

Für Einsteiger. Jeder Begriff: 1–2 Sätze. Die verbindlichen Regeln stehen in
[`AGENTS.md`](../../AGENTS.md) und [`docs/PLAN.md`](../PLAN.md) — dieses Glossar
erklärt nur die Wörter, es ersetzt keine Regel. Die wichtigsten Befehle stehen
im [Spickzettel](spickzettel.md).

## Git und GitHub

| Begriff | Was es heißt |
| --- | --- |
| **Git** | Das Programm, das jede Änderung am Code mit Zeitpunkt und Autor speichert. Man kann so jederzeit zu einem früheren Stand zurück. |
| **Branch** | Ein eigener Arbeitszweig: Änderungen liegen dort getrennt von `main`, bis sie fertig sind. Ein Paket = ein Branch. |
| **Commit** | Ein gespeicherter Schritt mit kurzer Beschreibung. Viele Commits ergeben die Geschichte eines Branches. |
| **PR** (Pull Request) | Die Bitte auf GitHub: „Bitte übernehmt meinen Branch in `main`.“ Hier stehen Bericht, Checks und Reviews. |
| **Draft** | Ein PR im Entwurfsstatus. Er läuft noch nicht durch die CI und wird nicht gemergt; erst „Ready for review“ startet beides. |
| **Merge-Queue** | Eine Warteschlange (Mergify), die grüne PRs nacheinander per „Merge“ (Zusammenführen) in `main` bringt. Du musst nicht selbst mergen. |
| **Rebase** | Den eigenen Branch so umbauen, als hätte er auf dem neuesten `main` begonnen. Schreibt Geschichte um — hier nur mit Absicht. |
| **Konflikt** | Zwei Änderungen betreffen dieselbe Stelle, Git weiß nicht, welche gilt. Ein Mensch oder Agent muss entscheiden; der PR bekommt das Label `conflict`. |
| **Worktree** | Ein zweiter Ordner mit einem eigenen Branch, aber demselben Repository. So arbeiten mehrere Agenten gleichzeitig, ohne sich zu stören. |
| **Hook** | Ein kleines Skript, das Git automatisch vor `commit` oder `push` ausführt und bei Fehlern stoppt. Hier liegen sie in `.githooks/`. |
| **Release** | Eine veröffentlichte Version der App (zuletzt v1.4.1). Ob und wann es eins gibt, entscheidest du. |

## Prüfen und Qualität

| Begriff | Was es heißt |
| --- | --- |
| **CI** | Automatische Prüfung auf GitHub bei jedem PR: baut, testet, lintet. Rot = etwas ist kaputt oder fehlt. |
| **Gate** | Eine einzelne Prüfstufe, die bestehen muss (z. B. Tests, Clippy). Die Liste steht nur in `scripts/ci/gates.sh`. |
| **red-first** | Erst ein Test, der fehlschlägt (rot) und den Fehler beweist; dann die Reparatur, bis er grün ist. Ein Check gleichen Namens prüft das im PR. |
| **Review** | Eine zweite Person oder KI liest die Änderung gegen und meldet Befunde. Der Autor darf sich nicht selbst prüfen. |
| **Migration** | Eine Änderung an der Datenbankstruktur (z. B. neue Spalte), die vorhandene Daten mitnehmen muss. Fehler hier sind schwer rückgängig zu machen. |

## Wie wir arbeiten

| Begriff | Was es heißt |
| --- | --- |
| **Lane** | Eine „Spur“: Alles, was dieselbe Datei anfasst, läuft nacheinander in einer Lane, nie gleichzeitig. |
| **Nahtstelle** | Eine zentrale Datei, an der vieles hängt (`api.rs`, `main.rs`, `store.rs`, `bin/pa.rs`). Nur ein Paket gleichzeitig darf sie ändern; Änderungen brauchen zwei Reviews. |
| **Orchestrator** | Der Agent, der Aufträge verteilt, Fortschritt beobachtet und Worker startet — er baut selbst wenig. |
| **Offizier** | Der Ersatz-Orchestrator: springt für einen kurzen Durchlauf ein, wenn der Orchestrator hängt oder am Limit ist. Hat ein kleines Budget. |
| **Worker** | Ein Agent, der genau ein Paket in einem eigenen Worktree umsetzt (Claude, Codex, Kimi, OpenCode …). |
| **Cloud-Sitzung** | Ein Claude-Lauf auf den Servern von Anthropic statt auf deinem PC. Praktisch für Parallelarbeit, verbraucht aber Guthaben — deshalb mit Tagesbudget. |
| **Continuous Mode** | Die Flotte startet Folgearbeit selbst. Bleibt ausgeschaltet, bis alle Abnahmekriterien erfüllt sind und du freigibst. |

## KI-Werkzeuge

| Begriff | Was es heißt |
| --- | --- |
| **Limit** | Die Nutzungsgrenze deines KI-Abos (5-Stunden-Fenster, Woche, Monat). Nie ausreizen: bei zu hoher Auslastung pausiert der Anbieter, ein anderer übernimmt. |
| **Kontext** | Alles, was die KI in diesem Gespräch gerade „im Kopf“ hat. Ist er voll, wird zusammengefasst und Details gehen verloren. |
| **Token** | Ein Textschnipsel (ungefähr ein Wortteil), in dem KI Länge und Verbrauch misst. Mehr Token = mehr Limit weg. |
| **MCP** | Ein Standard, mit dem Programme der KI Werkzeuge geben (Speicher, Browser, GitHub). Jeder MCP-Server, der beim Start lädt, kostet Zeit. |
| **LSP** | Ein Dienst, der Code „versteht“ (Fehler, Definitionen, Umbenennen). Editoren und Agenten fragen ihn statt nur Text zu durchsuchen. |
| **Skill** | Eine Anleitung als Textdatei (`SKILL.md`), die Claude bei passender Aufgabe lädt. Er ändert kein Programm, er lenkt nur das Vorgehen. |
| **Plugin** | Ein Paket, das Skills, Agenten und MCP-Server zusammen mitbringt und in Claude Code einbindet. |
