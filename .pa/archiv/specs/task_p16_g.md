# Task Batch G: Verdict-Token gegen Selbst-Approval (Phase 16, Entscheidung 1)

Status: historisch

Du bist ein Entwicklungs-Worker auf einem Linux-Server. Repo: `/root/wt/batchg`
(Branch `kimi/batchg`, aktuelles main). NUR dieser Worktree/Branch. NIEMALS
main, niemals force-push.

## Kontext

ProjectA (Tauri 2, Rust-Kern `src-tauri/src/`) hat eine Lernschleife: Agenten
schlagen Learnings/Rollen-Varianten vor, ein MENSCH reviewed und approved.
Befund P3-1 aus `.pa/triage_p16.md` (lesen, ebenso `.pa/report_p16_b.md` für
das API-Token-Design): die vier Verdict-Routen
(`POST /api/learnings/<id>/approve|reject`, `POST /api/roles/<id>/approve|reject`
in `src-tauri/src/api.rs`) verlangen nur das API-Token — und das kann jeder
Agent selbst aus `projecta-api.json` lesen. Die Kette approve →
`playbook_append` → PLAYBOOK.md → Prompt-Injection ist damit für Agenten
geschlossen.

## Vom Nutzer entschiedenes Design (verbindlich)

Zweites **Verdict-Token**, das NUR im Fenster-Prozess gehalten wird (nicht in
`projecta-api.json`, nicht in einer Datei, die ein Agent lesen kann):

1. Erzeugung wie das API-Token (`getrandom`, siehe api.rs), gehalten im
   Tauri-State, NICHT persistiert.
2. Die vier Verdict-Routen verlangen es zusaetzlich als Header
   (z. B. `X-Verdict-Token`); fehlt/falsch → 403. Zusaetzlich serverseitig
   `status == pending` pruefen (Approve/Reject einer bereits entschiedenen
   Zeile → 409 oder 4xx mit klarer Meldung).
3. Ein Tauri-Command (z. B. `get_verdict_token`) reicht das Token dem
   Frontend-Fenster; das UI (`LearningsPanel.tsx`) sendet es bei
   approve/reject als Header mit. Der Command ist ueber `generate_handler!`
   registriert wie die anderen.
4. `pa learnings approve|reject` und `pa roles approve|reject` (in
   `src-tauri/src/bin/pa.rs`) nehmen das Verdict-Token per Flag
   (`--verdict-token`) oder Env (`PA_VERDICT_TOKEN`) entgegen und senden es
   als Header. Ohne Token → der 403 des Servers, mit Hinweis im Hilfetext,
   dass das Token bewusst nur dem Menschen (Fenster/CLI-Flag) offensteht.
5. Fehler-Vokabular aus Batch E (`workers.rs`: `unknown <kind>: <id>`,
   `refused: <reason>`) verwenden, wo es passt.

## Regeln

- TDD: jede neue Verhaltensschiene zuerst rot (Route ohne Token → 403, mit
  falschem → 403, mit richtigem → 2xx; doppeltes Approve → 4xx; pa-Parser
  nimmt Flag/Env). API-Tests folgen dem Muster der bestehenden api.rs-Tests;
  pa-Tests dem Muster in `pa.rs` (siehe Batch F, `report_p16_f.md`).
- Gates vor Push: `cargo test`, `cargo clippy --all-targets -- -D warnings`,
  `cargo build` (in `src-tauri/`, cargo unter `~/.cargo/bin`); falls Frontend
  angefasst: `npm install && npm run typecheck && npm run build` (Repo-Root).
- Commit-Messages: Englisch, erklärend (Stil der Historie).
- Bericht `.pa/report_p16_g.md` + Kopie nach `/root/logs/batchg-report.md`,
  dann `git push origin kimi/batchg`.
- Nicht Umfang erweitern: der 500→4xx-Nachzug anderer Routen ist ein
  separates Paket.
