# Claude Queen: Phase 8 abschließen

Status: historisch

Repo: `<repo-root>`, Branch `main`.

## Deine Rolle

Du bist der **Queen-Orchestrator** für den Rest von ProjectA Phase 8. Kimi (diese Session) hat die Vorarbeit erledigt und überwacht dich. Du dispatchet OpenCode/GLM-Worker, führst Gates durch, fixest bei Bedarf und committest/pusht am Ende.

## Aktueller Stand (bevor du startest)

- Phase 7.3 ist auf `main` gemergt und gepusht.
- GitHub-Anbindung (Core + UI) ist auf `main` gemergt und gepusht.
- Design-Studio UI und Web-Interface UI sind fertig (OpenCode-Worker) und im Working Tree, aber noch **nicht** committet.
- Design-Studio Core wird gerade von einem OpenCode-Worker bearbeitet (`task_0d1836456d94`, Dispatch `ctx_e250b5cb2609`, Terminal `term_2ee51327-39b3-48ae-ac93-54374a03590f`).
- Web-Interface Core (`task_0ae1c51cc9b8`) wartet auf Design-Core (Dependency).

## Deine Run/Task-Struktur

1. Erstelle deinen eigenen Orca-Run:
   `orca orchestration run-create --objective "ProjectA Phase 8 finalisieren (Design + Web)" --json`
2. Erstelle Tasks in deinem Run für:
   - Web-Interface Core (`src-tauri/**`)
   - Finale Review/Fix-Zyklen (max 5)
   - STATUS.md/HANDOVER.md Update

## Ablauf

1. **Warte auf Design-Core.** Polling erlaubt:
   - `git status --short` zeigt irgendwann `src-tauri/src/store.rs`, `main.rs`, `api.rs`, ggf. `bin/pa.rs` geändert.
   - Oder: `orca orchestration task-list --run run_4c4167f7585f --json` zeigt `task_0d1836456d94` als `completed`.
   - Wenn der Worker nach >30 Minuten nicht fertig ist oder failed, melde dich mit `ask` bei Kimi.

2. **Sobald Design-Core fertig ist**, starte einen OpenCode/GLM-Worker für Web-Core:
   - Spec: `.pa/task_web_core.md`
   - Der Worker darf `src-tauri/**` ändern, NICHT `src/**`.
   - Warte auf `worker_done`.

3. **Integration-Gates.** Sobald Web-Core fertig ist, führe aus:
   ```bash
   cd src-tauri && CARGO_BUILD_JOBS=2 cargo test && CARGO_BUILD_JOBS=2 cargo clippy --all-targets -- -D warnings && CARGO_BUILD_JOBS=2 cargo build
   cd .. && npm run typecheck && npm run build
   ```
   - Wenn alles grün: weiter zu Schritt 5.
   - Wenn rot: erstelle einen Fix-Worker (OpenCode/GLM) mit konkreter Fehlerbeschreibung. Maximal 5 solcher Zyklen. Bei Blockern `ask` an Kimi.

4. **Review (optional aber empfohlen).** Wenn du unsicher bist, starte einen Claude/Codex-Reviewer, der die Diff gegen `main` prüft und nur Prosa-Findings meldet.

5. **Commit & Push.**
   - `git add -A && git commit -m "Phase 8: Design-Studio Landing Pages + Web-Interface (localhost)"`
   - `git push origin main`

6. **Doku aktualisieren.**
   - `STATUS.md`: Eintrag oben anfügen: was gebaut, wie verifiziert.
   - `HANDOVER.md`: Offene Branches/Worktrees prüfen, Phase-8-Status eintragen, Betriebshinweise aktualisieren (z.B. Web-Interface-Port 8787).

7. **Abschlussbericht an Kimi.**
   Sende von deinem Terminal aus `worker_done` an deinen eigenen Run mit 3 Sätzen: was fertig ist, Gate-Ergebnisse, was offen bleibt.

## Wichtige Regeln

- Niemals `.pa/secrets.json` lesen.
- Worker sollen nicht committen — das machst du als Queen.
- Bevorzuge `orca orchestration worker-start` oder `terminal create + dispatch` für OpenCode/GLM.
- Für OpenCode/GLM verwende das Kommando `opencode -m opencode-go/glm-5.3-flash`.
- Halte Kimi über `ask` auf dem Laufenden, wenn du eine wichtige Entscheidung treffen musst (z.B. Scope reduzieren, Dependency ändern).
