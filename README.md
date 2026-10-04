# ProjectA

<div align="center">
  <img src="assets/banner.svg" alt="ProjectA" width="100%" />
  <p><strong>Eine Windows-Desktop-App für mehrere parallele KI-Coding-Agenten.</strong></p>
</div>

ProjectA ist ein mit [Tauri 2](https://v2.tauri.app/) gebautes „agentic
terminal“. Die App startet installierte Coding-Agent-CLIs in getrennten
Terminals. Jeder Arbeitsauftrag erhält einen eigenen Git-Branch und Worktree;
die Oberfläche bündelt Terminals, Aufgaben, Diffs und den Projektstatus.

Der Rust-Kern verwaltet Laufzeitdaten in SQLite. Die Oberfläche verwendet
React und TypeScript. ProjectA bringt kein eigenes KI-Modell und keine
Anbieterzugänge mit: Die verwendeten CLIs müssen separat installiert und
angemeldet sein.

## Status

- Aktives persönliches Projekt; die aktuelle veröffentlichte Version ist
  `v1.4.1`. Neuere Änderungen auf `main` sind noch nicht veröffentlicht.
- Windows ist das einzige paketierte Ziel. Plattformneutrale und
  Linux-spezifische Prüfungen laufen zusätzlich unter Linux beziehungsweise
  WSL2; ein Linux- oder macOS-Paket wird nicht ausgeliefert.
- Der Continuous Mode ist absichtlich abgeschaltet, bis seine Abnahme
  vollständig belegt und vom Nutzer freigegeben ist.
- Interne Projektunterlagen sind überwiegend auf Deutsch.

## Voraussetzungen

- Node.js 24 oder neuer
- Rust 1.89 oder neuer (stable) und Cargo
- Git; für den vollständigen PR-Ablauf außerdem die GitHub CLI `gh`
- die [Tauri-2-Voraussetzungen für Windows](https://v2.tauri.app/start/prerequisites/)
- mindestens eine lokal eingerichtete Agent-CLI, wenn echte Worker gestartet
  werden sollen

Die anbieterspezifische Einrichtung steht unter
[`docs/setup/`](docs/setup/README.md).

## Lokal einrichten und prüfen

```sh
npm ci
npm run dev:doctor                 # nur Diagnose, verändert nichts
npm run dev:agent-check            # prüft die Agent-Entwicklungsumgebung
bash scripts/ci/doctor.sh           # zeigt, was diese Maschine belegen kann
bash scripts/ci/gates.sh --list     # aktuelle Gate-Liste
bash scripts/ci/gates.sh lane prepush
```

`prepush` ist die vollständige lokale Prüfbahn. Sie umfasst unter anderem
TypeScript-, Frontend-, HQ- und Rust-Prüfungen; die verbindliche Liste lebt nur
in `scripts/ci/gates.sh`. Kein einzelner Rechner deckt sowohl die
Windows- als auch die Linux-spezifischen Tests ab. Jeder Gate-Lauf nennt das
im Block `NICHT ABGEDECKT`; Details stehen in
[`docs/ci-lokal.md`](docs/ci-lokal.md).

`npm run dev:setup` richtet die Clone-lokalen Git-Hooks ein und erzeugt
`.pa/HQ-START.md`. Das ist eine bewusste schreibende Einrichtung und daher
nicht Teil der reinen Diagnose oben.

Die Desktop-App wird mit `npm run tauri dev` gestartet. Dabei können vorhandene
Queue-Einträge echte Agenten starten. Starte sie deshalb nur bewusst; für eine
Entwicklungssitzung ohne Dispatcher kann `PROJECTA_QUEUE=off` gesetzt werden.

## Sicher beitragen

1. Vor Beginn `STAND.md` und `docs/PLAN.md` lesen und den Live-Stand von
   `origin/main` und den offenen Pull Requests prüfen.
2. Pro Paket einen eigenen Branch und Worktree verwenden; fremde Änderungen
   nicht übernehmen oder verwerfen.
3. Für Fehler zuerst einen kompilierenden, fehlschlagenden Regressionstest
   hinzufügen. Reine Dokumentationsänderungen sind davon ausgenommen.
4. Vor jedem Commit den Secret-Scan und vor dem Push die vollständige
   `prepush`-Bahn im eigenen Worktree erfolgreich ausführen. Hooks nie umgehen.
5. Den Branch pushen, den Push gegen den Remote-Stand prüfen und einen
   Draft-PR mit Befehlen, Exit-Codes, Review-Ergebnissen und
   `NICHT ABGEDECKT`-Block eröffnen.
6. `main` nur über die Mergify-Queue zusammenführen; nicht rebasen oder
   force-pushen.

Die vollständigen, verbindlichen Regeln stehen in [`AGENTS.md`](AGENTS.md).

## Orientierung

| Datei | Zweck |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) | Verbindliche Arbeits-, Prüf- und PR-Regeln |
| [`STAND.md`](STAND.md) | Kurzer aktueller Projektstand |
| [`docs/PLAN.md`](docs/PLAN.md) | Einziger Plan: M1–M4, geparkte Arbeit und Entscheidungen |
| [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) | Bekannte offene Befunde |
| [`docs/setup/README.md`](docs/setup/README.md) | Einrichtung der Agent-Werkzeuge |
| [`docs/ci-lokal.md`](docs/ci-lokal.md) | Lokale Gates und Plattformgrenzen |
| [`SECURITY.md`](SECURITY.md) | Vertrauliches Melden von Sicherheitslücken |

## Lizenz

ProjectA steht unter der [MIT-Lizenz](LICENSE). Hinweise zu eingebundener
Drittsoftware stehen in
[`docs/THIRD_PARTY_NOTICES.md`](docs/THIRD_PARTY_NOTICES.md).
