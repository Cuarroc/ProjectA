# Design Studio: Landing Pages — UI

Status: historisch

Repo: `<repo-root>`, Branch `main`. FILE OWNERSHIP: NUR `src/**`. Ein paralleler Worker besitzt `src-tauri/**`. Nicht committen.

## Vertrag (Rust-Seite baut parallel)

- `invoke('get_landing_page', { projectId }) -> string|null`
- `invoke('set_landing_page', { projectId, markdown }) -> void`

## IMPLEMENT

1. `src/types.ts`:
   - `MainView` um `"design"` erweitern.
   - Optional: `LandingPage` type `{ markdown: string|null }`.

2. `src/lib/ipc.ts`:
   - `getLandingPage(projectId: string): Promise<string|null>`
   - `setLandingPage(projectId: string, markdown: string|null): Promise<void>`

3. `src/components/ViewBar.tsx`:
   - Views-Array um `{ id: "design", label: "Design" }` erweitern.

4. `src/App.tsx`:
   - Design-View rendern, wenn `view === "design"`.
   - `useBoard`-Abfrage ggf. auch für Design aktiv lassen (oder nicht — Design braucht keine Board-Daten).

5. Neues `src/components/DesignStudio.tsx`:
   - Props: `projectId: string | null`.
   - Zustände: `markdown`, `previewHtml`, `saving`, `error`.
   - Beim Aktivieren/Projektwechsel `getLandingPage` laden.
   - Zwei Bereiche nebeneinander (CSS-Grid):
     - Links: `<textarea>` für Markdown mit Toolbar-Buttons für `#`, `##`, `**`, `-`, `[text](url)`.
     - Rechts: Live-Preview als `<div dangerouslySetInnerHTML>`.
   - Markdown→HTML: ein kleiner eigener Parser in `src/lib/markdown.ts` (keine neue Dependency). Unterstützt: `# H1`, `## H2`, `### H3`, Leerzeilen als `<p>`, `**bold**`, `*italic*`, `- item` Listen, `[text](url)` Links, Zeilenumbrüche.
   - "Speichern"-Button ruft `setLandingPage` an; Erfolg visuell bestätigen, Fehler als rote Zeile.
   - "Exportieren"-Button kopiert den gerenderten HTML-Body in die Zwischenablage (optional, falls Tauri `writeText` verfügbar; sonst weglassen).
   - Wenn `projectId === null`: Hinweis "Projekt auswählen".

6. `src/styles.css`:
   - Dunkles Design für Design-Studio: textarea im Editor-Stil, Preview-Panel mit leichtem Rahmen, Preview-HTML mit lesbarer Typografie (Headings, Listen, Links in Akzentfarbe).

## VERIFY

```bash
npm run typecheck && npm run build
```

---
ORCA-LIFECYCLE: Du bist Orca-Worker. Task-ID und Dispatch-ID werden dir mitgeteilt. Bei Fertigstellung (typecheck + build grün) GENAU EINMAL:
`orca orchestration send --type worker_done --subject "Design Studio UI done" --body "<3 Sätze>" --task-id <TASK_ID> --dispatch-id <DISPATCH_ID> --outcome succeeded --json`. Bei Blockern: `orca orchestration ask --question "<frage>" --json`. Danach idle.
