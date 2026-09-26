# Team-Review Runde 1 — Rolle: Architektur & strukturelle Konsistenz

## Kontext

Du befindest dich im Repo von **ProjectA**: einer Tauri-2-Desktop-App („agentic
terminal") — Windows-first Control Center, das 3–5 CLI-Coding-Agenten parallel
in git-Worktrees führt. Rust-Kern in `src-tauri/src/` (~40 Module, **kein**
`lib.rs`, Binärcrate), React/TS-Frontend in `src/`, lokale Control-API plus
`pa`-CLI. Das Repo wird von mehreren KI-Instanzen parallel bearbeitet; die
vier „Nahtstellen" `api.rs`, `main.rs`, `store.rs`, `bin/pa.rs` bilden deshalb
eine serielle Lane (siehe `AGENTS.md`).

## Dein Auftrag

Review-Objekt: **`.pa/plan_post_rev9.md`** — ein Roadmap-Vorschlag für die Zeit
NACH dem aktiven Fokusplan (`docs/SANIERUNGSPLAN.md`, Rev 9).

Du bist einer von drei Reviewern in einem Team. Dies ist **Runde 1**: arbeite
allein, die anderen kennst du nicht. In Runde 2 bekommst du ihre Reviews und
darfst antworten, widersprechen oder eigene Befunde zurückziehen.

Deine Aufgabe ist nicht, den Plan zu loben. Deine Aufgabe ist, Gründe zu
finden, ihn NICHT so zu übernehmen — mit Belegen aus diesem Repo, nicht aus
dem Bauchgefühl.

## Pflichtlektüre — lies die Dateien wirklich, zitiere sie

1. `.pa/plan_post_rev9.md` — das Review-Objekt
2. `docs/SANIERUNGSPLAN.md` — besonders §1 (Lückenregister), §2 (Produktvertrag),
   §4 (Streichungen), §9 (Arbeitsregeln), §11 (Nächster Griff)
3. `STAND.md` — aktueller Stand und aktive Specs
4. `docs/decisions.md` — verbindliche Dreizeiler-Entscheidungen
5. `docs/ENTSCHEIDUNGEN-ZU-PRUEFEN.md`
6. `docs/superpowers/plans/2026-08-29-v11-ideen-pipeline-und-zeitachse.md`
7. `AGENTS.md`

Ein Review, das nur den Plantext kommentiert, ohne die Quellen zu öffnen,
gilt als nicht erbracht. Bweise die Lektüre durch wörtliche Zitate mit
Datei:Zeile.

## Deine Rolle: Architektur & strukturelle Konsistenz

Prüfe den Plan als Systemarchitekt:

- **Schritt 2 (Struktur-Light)**: Schau dir die reale Modulstruktur an
  (`src-tauri/src/`, Dateigrößen via Shell oder Read). Ist „`lib.rs` + dünnes
  `main.rs`" in einem Tauri-Binärcrate wirklich mechanisch, oder verstecken
  sich darin unterschätzte Arbeiten (z. B. Tauri-State, `tauri::generate_handler!`,
  Integrationstest-Erreichbarkeit)? Verträgt sich der vorgeschlagene
  store.rs/api.rs-Split mit der Rev-9-Regel „Strukturschnitte inkrementell,
  kein Big-Bang, keine Merge-Sperre"? Ist das nicht selbst ein Big-Bang?
- **Reihenfolge**: Widerspricht die Abfolge Schritt 1 → 2 → 3 einer Decision
  in `docs/decisions.md` (viele tragen „Zurücknehmen: nie")? Ist die
  behauptete Entscheidung vom 03.09. („Struktur-Light vor Feature-Phase")
  wirklich so fixiert?
- **Schritt 3 (~80 %-Komposition)**: Prüfe stichprobenartig, ob die genannten
  Module (`enhance.rs`, `questions.rs`, `scout.rs`, `critic.rs`, `learnings.rs`,
  `queue.rs`) existieren und die behaupteten Fähigkeiten haben. Die 80-%-Zahl
  stammt aus dem v1.1-Dokument vom 29.08. — gilt sie nach den Rev-9-Schnitten
  (Queen/Employee entfernt, Scout wird Preset, Attention-Inbox) noch?
- **Nahtstellen-Realismus**: Die vorgeschlagenen Pakete laufen fast alle durch
  `store.rs`/`api.rs`/`pa.rs` — ist die Schrittfolge gegen die serielle Lane
  geschnitten oder erzeugt sie genau die Kollisionen, die sie lösen will?

## Regeln

- Jeder Befund: Behauptung (Zitat aus dem Plan), Beleg (Datei:Zeile oder
  wörtliches Zitat), Schadensmechanismus, konkreter Vorschlag.
- Falsche Belegbehauptungen („steht so in X", steht aber nicht in X) sind der
  schwerste Befundtyp.
- Keine Befunde ohne Beleg. Maximal 15, nach Schwere sortiert.
- Richtiges und gut Belegtes knapp unter „Was trägt" anerkennen — sonst nichts.
- Antworte auf Deutsch. Nur Lesen, nichts verändern.

## Ausgabeformat (exakt einhalten)

URTEIL: <annehmen | überarbeiten | ablehnen>
BEGRÜNDUNG: <3–6 Sätze>

BEFUNDE (nach Schwere sortiert, maximal 15):

### A-01 — <Titel>
- Schwere: <hoch|mittel|niedrig>
- Abschnitt: <welcher Schritt des Plans>
- Behauptung: <Zitat aus dem Plan>
- Beleg: <Datei:Zeile oder Zitat>
- Vorschlag: <konkret>

## Was trägt
<max. 5 Aufzählungspunkte>
