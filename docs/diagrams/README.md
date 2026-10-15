# Diagramme der README

Die drei Diagramme der [`README.md`](../../README.md) sind mit
[Archify](https://github.com/tt-a1i/archify) (MIT-Lizenz, Autor tt-a1i)
aus Belegen im Quellcode erzeugt. GitHub führt kein HTML oder JavaScript aus;
deshalb liegen unter `docs/assets/readme/` statische,
eigenständige SVGs (Stile eingebettet, kein `<script>`, keine externen
Verweise), je eine helle und eine dunkle Fassung. Die große HTML-Fassung von
Archify wird nicht eingecheckt.

| Diagramm | Kandidat (Quelle der Wahrheit) | SVG hell / dunkel |
| --- | --- | --- |
| Aufbau | [`architektur.architecture.json`](architektur.architecture.json) | `architektur-light.svg`, `architektur-dark.svg` |
| Ablauf bis `main` | [`ablauf.workflow.json`](ablauf.workflow.json) | `ablauf-light.svg`, `ablauf-dark.svg` |
| Vom Merge zum Update | [`release.workflow.json`](release.workflow.json) | `release-light.svg`, `release-dark.svg` |

Jeder Kasten im Kandidaten nennt unter `sources` Datei und Zeilen, die ihn
belegen; `meta.repository.revision` hält den Stand fest, auf den sich die
Zeilen beziehen. Ändert sich der Code dahinter, müssen Revision und Zeilen
nachgezogen werden.

## Neu erzeugen

Voraussetzungen: Archify (Skill) und Chromium. Die Farben kommen aus
[`src/design/tokens.css`](../../src/design/tokens.css) und stehen in
[`export-svg.mjs`](export-svg.mjs).

```sh
# 1. Kandidat prüfen und als HTML rendern (validate, check, browser-check)
node <archify>/bin/archify.mjs finalize architecture docs/diagrams/architektur.architecture.json architektur.html --repo-root . --quality showcase
# 2. Statisches SVG je Farbschema schreiben
node docs/diagrams/export-svg.mjs export architektur.html docs/assets/readme/architektur-light.svg light "<Titel>" "<Beschreibung>"
node docs/diagrams/export-svg.mjs export architektur.html docs/assets/readme/architektur-dark.svg dark "<Titel>" "<Beschreibung>"
# 3. Kontrast aller Textfarben prüfen (Mindestwert 4,5:1, sonst Exit 1)
node docs/diagrams/export-svg.mjs contrast docs/assets/readme/*.svg
```

`ARCHIFY_CHROME` zeigt auf die Chromium-Datei, `ARCHIFY_NO_SANDBOX=1` schaltet
dessen Sandbox ab, wo sie nicht verfügbar ist (nur für diese lokalen Dateien).
Das HTML (`*.html`) gehört nicht ins Repository.
