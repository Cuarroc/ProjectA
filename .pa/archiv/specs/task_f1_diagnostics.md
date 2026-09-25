# F1-Diagnostics: P2-H — Logpfad, Diagnosepaket, „Warum?"

Status: historisch

Repo: `<repo-root>`. **Nicht committen, nicht pushen, nicht
mergen.** Ein Mensch fährt die Gates und committet.

Plan: `docs/SANIERUNGSPLAN.md` Rev 9, F1 (P2-H und Diagnosepaket).

## Reihenfolge — dieses Paket geht zuletzt

Es hat **zwei** Vorgänger, nicht einen:

1. `.pa/task_f1_single_instance.md` — teilt `main.rs`. Single-Instance zuerst,
   weil es das Plugin als erstes am Builder registriert.
2. `.pa/task_f1_attention.md` — die „Warum?"-Ansicht muss **jeden** Reason-Code
   aus Attention erklären, und Attention baut die Menge gerade erst. Zusätzlich
   fasst Attention `src/App.tsx` an, das du zum Montieren brauchst.

`.pa/report_f0.md` §6 zeichnet Diagnostics unabhängig von Attention. Das ist
falsch und hier korrigiert (04.09.).

Prüfe vor dem ersten Schreibzugriff `git status --short --branch` und ob beide
Vorgänger gelandet sind.

## Warum

Diagnose ist dateibasiert vorhanden, aber kein Produktfluss. File-Logging,
Redaction und Panic-Marker existieren; der Panic-Marker landet heute
ausschließlich in Log und stderr (`main.rs:2336-2339`) — und der Code sagt selbst,
wohin er eigentlich gehört: *„the visible notice in the window is the diagnosis
pack's job (P2-H)"* (`main.rs:2334-2335`). Ein Release-Build hat keine Konsole;
für den Nutzer ist ein Absturz damit heute unsichtbar.

## Deine Dateien (EXKLUSIV)

- `src-tauri/src/main.rs`, `src-tauri/src/api.rs`, `src-tauri/src/bin/pa.rs`
- `src-tauri/src/logging.rs`, `src-tauri/src/redact.rs`
- neues Diagnostics-Panel unter `src/components/`, `src/lib/ipc.ts` (nur die
  neuen Aufrufe), `src/styles.css` (nur der neue Block)
- **Montage, eng begrenzt:** `src/App.tsx` (Import + ein Render-Zweig),
  `src/components/ViewBar.tsx` (ein Navigationseintrag), `src/types.ts` (eine
  `MainView`-Variante). Mehr nicht — der Navigationsumbau gehört F2-UI.
  Ohne diese Ausnahme wäre die Abnahme „Logpfad aus der App erreichbar" nicht
  erfüllbar und du bautest eine verwaiste Komponente.

**Nicht anfassen:** `status.rs`, `useBoard.ts`, `ConversationView.tsx`
(gehören `.pa/task_f1_attention.md`), `store.rs`, `workers.rs`,
`tauri.conf.json` (gehört Single-Instance).

## Auftrag

1. **Diagnostics-Ansicht** mit Logpfad (kopierbar, im Explorer zu öffnen),
   Diagnosepaket-Export und einer „Warum?"-Ansicht je Task/Agent, die den
   Reason-Code aus F1-Attention in Klartext auflöst.
2. **Panic-Hinweis sichtbar machen.** `take_panic_notice` (`logging.rs:146`) wird
   beim Start bereits gelesen und rotiert; sein Ergebnis muss den Nutzer
   erreichen, nicht nur das Log.
3. **Diagnosepaket aus einer strukturellen Feld-Allowlist bauen** — nicht aus
   einem Filter über allem, was gerade da ist.

   **Das Universum des Pakets ist hiermit festgelegt** (ohne es wäre weder die
   Allowlist noch die Canary-Matrix vollständig prüfbar, und du würdest die
   Felder selbst wählen und damit nur deine eigene Wahl beweisen):

   | Aufnehmen | Nicht aufnehmen |
   |---|---|
   | App-Version, Build, OS-Version, Schema-`user_version` | — |
   | Logauszug: die letzten N Zeilen der rotierten Datei | ältere Rotationen |
   | Panic-Marker, aktuell und vorherig (`logging.rs:22-25`) | — |
   | Projekt: `id`, `name`, `max_workers`, ob `test_command` gesetzt | `repo_path` (Pfade tragen Namen), `landing_page_markdown` |
   | Worker: `id`, `kind`, `status`, Spalte, Reason-**Code**, `test_status`, `branch` | `task` — agentengeschriebener Freitext |
   | Settings: **Schlüsselnamen und ob gesetzt** | jeder Wert |
   | Provider: `id` und ob ein Key hinterlegt ist | jeder Key |
   | Zähler: Anzahl Worker, Fragen, Empfehlungen | Messages, Fragetexte, Notification-Texte |

   Die Regel dahinter: Freitext, den ein Agent oder ein Provider geschrieben hat,
   ist kein Diagnosefeld. Er ist der wahrscheinlichste Ort, an dem ein
   hineinkopiertes Secret liegt, und `redact.rs` sagt über sich selbst, es sei
   „a seatbelt … not a scanner".

   Zusätzlich alle **produktverwalteten Secret-Werte exakt entfernen**: API-Token
   (`projecta-api.json`, `api.rs:716`), Verdict-Token, Hook-Secrets
   (`hooks.rs:85-137`), Web-Interface-Token (DB-Settings `web_interface.token`),
   Provider-Schlüssel aus dem KeyVault (`providers.rs:608 ff.`) und der
   OmniRoute-Management-Token.
4. **Canary-Test.** Pflanze **jeden** Secret-Typ in **jedes** zulässige Feld der
   Allowlist und belege, dass keiner im Export auftaucht — weder exakt noch
   abgeleitet (Präfix, Teilstring, andere Kodierung). Heuristische Redaction
   allein ist ausdrücklich **kein** Beleg; `redact::looks_secret` (`redact.rs:57`)
   ist die zweite Verteidigungslinie, nicht die erste.

## Abnahme

- Ein Absturz im vorigen Lauf erzeugt beim nächsten Start einen sichtbaren,
  verständlichen Hinweis im Fenster — belegt im **paketierten** Build, nicht nur
  in Vite.
- Der Canary-Export enthält keinen exakten und keinen abgeleiteten Secret-Wert.
- Die „Warum?"-Ansicht erklärt jeden Reason-Code aus F1-Attention; ein Code ohne
  Erklärung ist ein Fehlschlag, kein Restposten.
- Logpfad ist aus der App heraus erreichbar, ohne dass jemand `%APPDATA%` kennt.

## Gates

```text
cargo test
cargo clippy --all-targets -- -D warnings
cargo fmt --check
cargo build
npm run typecheck
npm test
npm run build
npm run lint
```

Exit-Codes ungemaskiert lesen.

## Report

`.pa/report_f1_diagnostics.md`: die Feld-Allowlist, die Canary-Matrix
(Secret-Typ × Feld) mit Ergebnis, und der Beleg aus dem paketierten Build.
