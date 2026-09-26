# Task: Masterprompt Worker

Status: historisch

Ziel: Einstellungen-Tab mit globalem Masterprompt, Integration in Worker- und Orchestrator-Dialoge.

## 1. Settings-Tab / Settings-Dialog

Erstelle eine neue Komponente `src/components/SettingsView.tsx` (oder `SettingsDialog.tsx`).

Sie soll folgende Tabs haben:

### Tab "Allgemein"
- Toggle: "Onboarding-Hinweise anzeigen" (speichern in `localStorage` key `projecta.settings.onboarding`)
- Eingabe: "Default Port Web-Interface" (speichern in `localStorage` key `projecta.settings.webPort`)

### Tab "Masterprompt"
- Große Textarea für den globalen Masterprompt (speichern in `localStorage` key `projecta.settings.masterPrompt`)
- Toggle: "Masterprompt für alle Agenten verwenden"
- Vorschau des Prompts unterhalb

### Tab "Agent-Kategorien"
- Liste der Kategorien: Worker, Queen, Employee, Scout, Orchestrator
- Pro Kategorie:
  - Toggle "Aktiv"
  - Dropdown "Default Profile" (Profile kommen von `listAgentProfiles`)
  - Kurze Beschreibung
- Speichern in `localStorage` key `projecta.settings.agentCategories`

## 2. Settings-Zugang

- Füge in `ViewBar.tsx` einen "Settings"-Button ganz rechts hinzu (neben "New worker").
- Oder füge einen neuen View `"settings"` zu `MainView` in `src/types.ts` hinzu und zeige `SettingsView` in `App.tsx` an, wenn dieser View aktiv ist.
- Empfohlen: neuer View `"settings"` statt Dialog, damit es wie ein Tab aussieht.

## 3. Masterprompt-Integration

- In `NewWorkerDialog.tsx`: Füge einen Toggle "Masterprompt anhängen" hinzu. Wenn aktiv, wird der gespeicherte Masterprompt vor den Task-Text gesetzt (z. B. `MASTERPROMPT\n\n---\n\nTASK`).
- In `Sidebar.tsx`: Wenn der Orchestrator-Toggle aktiviert wird, fülle die Prompt-Textarea mit dem Masterprompt (falls vorhanden und aktiviert).
- In `QueuePanel.tsx` (falls einfach machbar): Wenn ein Task zur Queue hinzugefügt wird, hänge den Masterprompt an, falls aktiviert.

## 4. Types & IPC

- Erweitere `src/types.ts` um `MainView = "board" | "workers" | "usage" | "design" | "settings"`.
- Füge ggf. Helper-Funktionen in `src/lib/settings.ts` hinzu:
  - `loadMasterPrompt(): string`
  - `saveMasterPrompt(prompt: string): void`
  - `loadAgentCategories(): AgentCategoryConfig[]`
  - etc.

## Verifikation

- `npm run typecheck` muss grün sein.
- `npm run build` muss grün sein.
- `cargo test` und `cargo clippy` sollten nicht beeinflusst werden (dieser Task ändert nur Frontend).

## Hinweise

- Verwende `localStorage` für alle Settings; keine Rust-Änderungen nötig.
- Achte auf TypeScript-Typen; führe keine `any`s ein.
- Lies `src/App.tsx`, `src/components/ViewBar.tsx`, `src/components/NewWorkerDialog.tsx`, `src/components/Sidebar.tsx`, `src/types.ts` und `src/lib/ipc.ts` vor der Änderung.
