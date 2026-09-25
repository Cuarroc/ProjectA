# Unabhängiges Zweit-Review: F4-Spec „Merge-Kandidat und Setup-Ausführung"

## Kontext

Du befindest dich im Repo von **ProjectA** (Tauri 2: Rust-Kern in
`src-tauri/src/`, React/TS-Frontend in `src/`). Eine **andere Instanz**
(Codex-getrieben) implementiert gerade die Spec `.pa/task_f4_merge_candidate.md`
— der Stand liegt **uncommittet** im Baum (`testgate.rs`,
`testgate/candidate.rs`, `workers.rs`, `setupgate.rs`, `readiness.rs`,
`main.rs`, `src/lib/ipc.ts`, `src/components/DiffView.tsx` u. a.).

Der erste externe Reviewer hat **ACCEPT mit fünf Ergänzungen** gegeben
(Projektidentität von Kandidateninputs trennen; aktuelle Policy prüfen;
Kinder auch nach erfolgreichem Shell-Exit beenden; Kandidat ohne Ausnahmen
für `.claude/`/`.agents/` prüfen; Isolation nicht als unveränderliche Sandbox
darstellen) — sie werden gerade umgesetzt. Der zweite Reviewer ist am
Kontingentlimit abgebrochen. **Du bist das fehlende unabhängige
Zweit-Review** (Repo-Regel: Dual-Review durch zwei KIs ≠ Autor vor Merge).
Du hattest keinen Anteil an Spec oder Umsetzung.

## Pflichtlektüre — lies die Dateien wirklich, zitiere mit Datei:Zeile

1. `.pa/task_f4_merge_candidate.md` — das Review-Objekt (25 Zeilen, Spec)
2. `.pa/report_sanierung_rest_2026-09-08.md` — Arbeitsstand: roter Beleg,
   17 grüne testgate-Tests, die fünf Ergänzungen, offene Punkte
3. `docs/SANIERUNGSPLAN.md` — §5 (Review Readiness, Evidence-Tupel) und das
   F4-Paket samt Abnahme
4. `docs/decisions.md` — Setup-Trust (03.09.), Merge-Tree-Runner (07.09.),
   Verdict-Token (04.09.)
5. `STAND.md` §3 — aktive Specs und ihre Lanes
6. Code: `src-tauri/src/testgate.rs`, `src-tauri/src/testgate/candidate.rs`,
   `src-tauri/src/setupgate.rs`, `src-tauri/src/readiness.rs`,
   `src-tauri/src/proc.rs` (Kindprozess-Kill), `src-tauri/src/workers.rs`
   (Merge-Guard-Kette)

Ein Review ohne geöffnete Quellen gilt als nicht erbracht.

## Mindestens zu prüfen (nicht erschöpfend)

1. **Spec-Punkt 4** („Kindprozesse enden vor Validierung/Cleanup, auch bei
   erfolgreichem Shell-Exit"): ist das unter Windows über `proc.rs`
   realistisch — und prüft es ein Test?
2. **Punkte 5+6 (Setup-Trust)** gegen `decisions.md` 03.09. („Setup-Trust
   bindet Repo, Befehl, Base-SHA und ausführbare Inputs; jede Änderung
   verfällt"): deckt die Spec das, oder fehlt etwas?
3. **Die Grenze** am Spec-Ende: „Isolation verhindert gewöhnliche
   Worker-Eingriffe, keine beliebigen zwischenzeitlichen Selbständerungen
   eines Testkommandos mit Wiederherstellung." Ist diese Ausnahme
   akzeptabel dokumentiert oder ein stiller Vertrauensbruch? Müsste der
   Setup-Trust-Hash über ausführbare Inputs genau das abdecken?
4. **Lane-Kollision**: die Spec will UI-Wiring über `main.rs`/`ipc.ts`/
   `DiffView.tsx`; `STAND.md` §3 weist `task_f4_review_ui` die
   `main.rs`-Commands „nach Setup" zu. Kollidiert das, oder ist die
   Serienfolge sauber definiert?
5. **Der rote Beleg** im Report (`a_diverged_base_is_tested_without_changing_the_worker_checkout`):
   echter roter Test im Sinne der Repo-Regeln (kompiliert und schlägt fehl)?
6. **Die fünf Ergänzungen des Erstreviewers**: vollständig adressiert in Spec
   oder Code? Was fehlt darüber hinaus?

## Regeln

- Jeder Befund: Behauptung, Beleg (Datei:Zeile/Zitat), Schaden, Vorschlag.
- Keine Befunde ohne Beleg. Maximal 12, nach Schwere sortiert.
- Deine Aufgabe ist, Gründe gegen die Freigabe zu finden — nicht Lob.
  Tragfähiges gehört knapp unter „Was trägt".
- Antworte auf Deutsch. Nur lesen, nichts verändern. Pfade außerhalb dieses
  Arbeitsordners sind tabu.

## Ausgabeformat (exakt einhalten)

URTEIL: <freigeben | freigeben mit Auflagen | überarbeiten | ablehnen>
BEGRÜNDUNG: <3–6 Sätze>

BEFUNDE (nach Schwere sortiert, maximal 12):

### F-NN — <Titel>
- Schwere: <hoch|mittel|niedrig>
- Behauptung: <Zitat>
- Beleg: <Datei:Zeile>
- Vorschlag: <konkret>

## Was trägt
<max. 5 Aufzählungspunkte>
