# GitHub-Anbindung: Frontend (UI-Worker)

Status: historisch

Repo: Orca-Worktree, in dem du laeufst (Branch ist vorbereitet). ProjectA = Tauri 2
"agentic terminal", React + TypeScript, dunkles minimales Styling. Lies ZUERST:
`src/lib/ipc.ts`, `src/components/Sidebar.tsx`, `src/components/SkillPackDialog.tsx`
(Dialog-Muster), `src/types.ts`, `src/styles.css`.
FILE OWNERSHIP: NUR `src/**`. Ein paralleler Worker besitzt `src-tauri/**`. NICHT committen.

## Vertrag (die Rust-Seite baut parallel dagegen)

- `invoke('create_github_repo', { projectId, name, private }) -> string` (repo url)
- `invoke('link_github_remote', { projectId, url }) -> void`
- `invoke('list_projects')` liefer die Projekt-Objekte NEU mit additivem Feld
  `githubRemote: boolean` (kommt von der Rust-Seite; in `types.ts` ergaenzen)

## IMPLEMENT

1. `types.ts`: `Project` um `githubRemote: boolean` erweitern (additiv).
2. `ipc.ts`: die zwei neuen invoke-Wrapper im Stil der Nachbarn.
3. Sidebar: Pro Projekt-Zeile — wenn `githubRemote === false`, ein kleines
   GitHub-Verknuepfungs-Icon/Button (z.B. "GH+"); wenn true, nichts (oder dezentes
   vorhandenes Indikator-Icon, nur wenn es schon ein Muster dafuer gibt).
4. Neuer Dialog `GitHubLinkDialog.tsx` (Muster: SkillPackDialog): Tabs oder
   Umschalter "Neu erstellen" / "Bestehendes verknuepfen":
   - Neu: Name (vorbefuellt mit Projektname), Checkbox "privat" (default an),
     Button "Erstellen" → `create_github_repo`; Erfolg: URL anzeigen + Dialog schliessen,
     Projektliste aktualisieren.
   - Verknuepfen: URL-Textfeld, Button "Verknuepfen" → `link_github_remote`.
   - Fehler aus dem Backend als rote Zeile im Dialog, nicht als Alert.
   - Escape/Backdrop schliesst. Refresh der Projektliste nach Erfolg.
5. Styles in `styles.css` im bestehenden dunklen minimalen Stil, keine neuen Deps.

## VERIFY

`npm run typecheck` und `npm run build` — beide gruen. NICHT committen — der Koordinator
reviewt und committet.

---
ORCA-LIFECYCLE: Du bist Orca-Worker. Task-ID und Dispatch-ID stehen in der injizierten
Praeambel bzw. werden dir im Prompt mitgeteilt. Bei Fertigstellung (typecheck + build
gruen) GENAU EINMAL: orca orchestration send --type worker_done --subject
"GitHub-Anbindung UI done" --body "<3 Saetze>" --task-id <TASK_ID>
--dispatch-id <DISPATCH_ID> --outcome succeeded --json. Bei Blockern:
orca orchestration ask --question "<frage>" --json. Danach idle.
