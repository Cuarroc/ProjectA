# Report W5-28 — Automatischer Laufzeit-Beleg (Sandbox, Queue aus)

Paketzeile (`.pa/plan_projects_w5.md`, Phase D): „rot: der Beleg entsteht,
ohne dass ein echter Worker startet (eigenes Datenverzeichnis, Queue aus);
Aufbewahrungsgrenze greift". Automatisiert die M1-Abnahme: die App startet,
und alte Queue-Aufträge schicken keine Agenten los.

## Was sich geändert hat

- `src-tauri/src/queue.rs`: `PROJECTA_QUEUE=off` (auch `0`/`false`) lässt
  `queue::start` vor dem Dispatcher-Thread aussteigen, mit Logzeile. Reattach
  und Claim-Auflösung bleiben unverändert (geben Claims nur nach `ready`
  frei, spawnen nie). Unit-Tests pinnen die Auswertung.
- `scripts/runtime-proof.mjs` (+ npm-Script `proof:runtime`): fährt den
  Beleg lokal. Phase 1 startet die App mit eigenem `PROJECTA_APP_DATA` und
  `PROJECTA_QUEUE=off`, legt über die Control-API ein Scratch-Projekt und
  zwei alte Queue-Einträge an; Phase 2 startet auf demselben Datenverzeichnis
  neu und belegt nach >2 Sweep-Intervallen (70 s) per API: Einträge weiter
  `ready`, null Worker, Logzeile vorhanden, Fenster-Screenshot. Verweigert
  den Start, solange ein Produktiv-`projecta.exe` läuft (geteilte
  Single-Instance-Mutex), außer `--parallel-ok` für Builds mit abweichender
  Bundle-ID (`TAURI_CONFIG`).
- `scripts/lib/runtime-proof-lib.mjs` + Tests: Layout, Verdikt und
  Aufbewahrung (10 jüngste Läufe) als pure Funktionen, 9 node:test-Tests.
- `scripts/window-shot.ps1`: `-TargetPid` (kein Titel-Fallback mehr bei
  PID-Vorgabe) und PrintWindow-Fallback gegen den Foreground-Lock.
- `src-tauri/src/skills.rs`: rustfmt-Re-Wrap — der öffentliche Squash
  c60f267 war mit stable rustfmt 1.9 fmt-rot und blockierte die
  precommit-Lane für jeden src-tauri-Commit (CI-Push-Lauf 36128534223 rot).
- `docs/decisions.md`: Journaleintrag.
- `package.json`: Script `proof:runtime`.

Nicht in CI-Gates eingehängt: der Lauf braucht WebView2/Fenster und ist
laut Auftrag nur lokal/Test. Kein Provider-CLI wird je aufgerufen.

## Rot → Grün

- `cargo test queue_dispatch_disabled`: rot Exit 101 (E0425, Funktion
  fehlte) → grün Exit 0, 2/2.
- `node --test scripts/lib/runtime-proof-lib.test.mjs`: rot Exit 1 (Modul
  fehlte) → grün Exit 0; nach Review-Tests rot Exit 1 (7/9) → grün 9/9.
- Red-first-Trailer auf jedem Code-Commit; Reihenfolge Test vor Impl.

## Gates

- `bash scripts/ci/gates.sh lane prepush` (Windows, Slot projecta-c):
  fmt, typecheck, lint, fe-test, hq-test, clippy, rust-suite (1605/1605)
  grün, Summenzeit 370 s. Ein erster Lauf meldete am Ende Exit 1, weil die
  Dispositionsdatei während des Laufs uncommittet entstand — kein Gate,
  sondern der Arbeitsbaum-Wächter; danach alle Dateien committet.
- Live-Belegläufe (Produktiv-App lief die ganze Zeit, unangetastet):
  - Debug-Build `com.projecta.proof`: Exit 0 (Screenshot zeigte die
    devUrl-Fehlerseite — plain cargo build ohne `custom-protocol`).
  - Release-Build `--features tauri/custom-protocol`, Lauf
    2026-09-25T14-20-58Z: Exit 0; proof.json: Start 1048 ms / Restart 781 ms,
    2 Einträge nach 70 s `ready`, `workers: []`, Screenshot inspiziert:
    zeigt die echte App-UI des Sandbox-Projekts, „0 workers".
  - Schutzschiene verifiziert: ohne `--parallel-ok` bei laufender
    Produktiv-Instanz Verweigerung mit Exit 1.

## NICHT ABGEDECKT von diesem Lauf

- die `#[cfg(unix)]`-Tests (Dateirechte, Prozessgruppen-Kill) — kompilieren
  unter Windows nicht (KNOWN_ISSUES KI-7); die Linux-Arme von clippy.
  Dieser Lauf belegt die Windows-Hälfte, nicht die Linux-Hälfte.
- Browser-Smoke, Frontend-Build-Gate und Workflow-Gates laufen erst in der
  Bahn `linux` (CI).
- Der Beleg läuft nicht auf CI-Runnern (braucht WebView2/Fenster).
- Externe Dienste (Updater, OmniRoute) prüft kein Gate — Release-Verify.

## Reviews

Siehe `.pa/review_w5-28_disposition.md`. glm-5.2 R1 (4 Befunde: F1 hoch,
F2/F3 mittel, F4 niedrig — alle dispositionsfest), qwen2.5-coder (kein neuer
Befund), glm-5.2 R2 auf dem Delta (F1/F2 bestätigt, F3 geschärft, ein neues
Low). Advisor-Paar nicht erreichbar (Codex-Kontingent bis 30.09.,
Claude-Subagent HTTP 402); deepseek-v4-flash:cloud bei Ollama gelöscht
(410), qwen3.8:latest nicht antwortend (500). Zweitreview daher durch
qwen2.5-coder:7b lokal.

## Offene Punkte / Folgearbeit

- Der öffentliche Squash-Stand hat zwei repo-weite, schon vor diesem Paket
  rote Stellen: Gate `selftest-review` (CI linux) schlägt fehl, weil
  `.pa/review_transport.py` nicht veröffentlicht ist; und `cargo fmt
  --check` war auf main rot (hier mitgeführt als Re-Wrap). Beides gehört in
  ein Publish-Hygiene-Paket, nicht in W5-28.
- W5-28-Zeile steht nur im privaten W5-Plan; im öffentlichen `docs/PLAN.md`
  gibt es keine Checkbox zum Abhaken.
- Debug-Exes ohne `custom-protocol` zeigen im Fenster die devUrl-Fehlerseite;
  der Treiber-Kommentar sagt das jetzt. Für den UI-Screenshot Release- oder
  Feature-Build nehmen.
