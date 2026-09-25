# Phase 14 / Worker C — Learnings-Panel, Settings-Toggles, Karten-Button

Status: historisch

Repo: `<repo-root>`, Branch `main`. Du arbeitest **im Repo-Root**,
nicht in einem Worktree. **Nicht committen, nicht pushen, nicht mergen.**

## Deine Dateien (EXKLUSIV — fasse keine anderen an)

- `src/types.ts`
- `src/lib/ipc.ts`
- `src/components/LearningsPanel.tsx` (NEU)
- `src/components/SettingsView.tsx`
- `src/components/BoardView.tsx`
- `src/components/Sidebar.tsx`
- `src/App.tsx`
- `src/styles.css`

**Kein Rust.** `src-tauri/**` gehoert Worker A und B, die parallel arbeiten. Du siehst
die neuen Tauri-Commands eventuell noch nicht im Backend — das ist normal und blockiert
dich nicht: das Frontend hat keine Test-Infra und `npm run typecheck && npm run build`
prueft die Rust-Seite nicht.

## Konventionen

Kommentare **Englisch**, alle **UI-Strings Deutsch**, **keine neuen Dependencies**,
keine Test-Infra im Frontend. Stil strikt wie die Nachbarschaft —
`components/RecommendationsPanel.tsx` ist dein Vorbild fuer das Panel,
`components/SettingsView.tsx` fuer die Toggles. Kein `npm run tauri dev`.

---

## Fixierte Vertraege (nicht verhandelbar)

Tauri-Command-Namen und Argumente (camelCase):

    list_learnings          { projectId }                -> Learning[]
    approve_learning        { id, text }                 -> void
    reject_learning         { id }                       -> void
    run_learning_critic     { workerId }                 -> number   (Anzahl neuer Learnings)
    set_profile_enabled     { id, enabled }              -> void
    set_category_learning   { category, enabled }        -> void
    get_learning_settings   { }                          -> Record<string, boolean>
    list_agent_profiles     { }                          -> AgentProfile[]   (jetzt mit `enabled`)

Kategorien-Schluessel fuer `set_category_learning` / `get_learning_settings`:
`"worker"`, `"queen"`, `"orchestrator"`, `"scout"`.

Learning-JSON kommt in camelCase (siehe `types.ts` unten).

---

## 1. `src/types.ts`

    /** One insight a critic distilled from a finished run, awaiting review. */
    export interface Learning {
      id: string;
      projectId: string;
      workerId: string;
      profileId: string;
      patternLabel: string | null;
      content: string;
      status: LearningStatus;
      createdAt: number;
    }

    export type LearningStatus = "pending" | "approved" | "rejected";

`AgentProfile` bekommt `enabled: boolean;`.

## 2. `src/lib/ipc.ts`

Wrapper fuer alle Commands oben, im Stil des `// -- scout & recommendations`-Blocks:
ein `RawLearning`-Interface, eine `toLearning`-Normalisierung (unbekannter Status ->
`"pending"`, fehlendes `patternLabel` -> `null`, kaputte Eintraege werden ausgefiltert
wie bei `toRecommendation`), dann:

    export async function listLearnings(projectId: string): Promise<Learning[]>
    export function approveLearning(id: string, text: string): Promise<void>
    export function rejectLearning(id: string): Promise<void>
    export function runLearningCritic(workerId: string): Promise<number>
    export function setProfileEnabled(id: string, enabled: boolean): Promise<void>
    export function setCategoryLearning(category: string, enabled: boolean): Promise<void>
    export function getLearningSettings(): Promise<Record<string, boolean>>

Eigener Abschnitts-Kommentar `// -- learnings (Phase 14) ---`.
`AgentProfile`-Normalisierung: falls `list_agent_profiles` ein Profil ohne `enabled`
liefert, gilt `true`.

## 3. `src/components/LearningsPanel.tsx` (NEU)

Baue es strukturell wie `RecommendationsPanel.tsx`: gleiche Props-Form, gleiches
Collapse-Verhalten, gleiches Poll-Muster, gleiche Notice-Mechanik, gleiche
`describeError`-Fehlerbehandlung.

    interface LearningsPanelProps {
      /** `null` means there is no active project and nothing to review. */
      projectId: string | null;
    }

Verhalten:

- Laedt `listLearnings(projectId)` beim Mount, bei Projektwechsel und per Poll
  (`const POLL_MS = 15_000;`, wie im Vorbild). Zeigt nur `status === "pending"`.
- Header mit Titel **„Learnings"** und einem Badge mit der Anzahl offener Learnings
  (kein Badge bei 0).
- Pro Eintrag:
  - Pattern-Badge mit `patternLabel`, falls vorhanden (sonst kein Badge).
  - Der **Volltext** von `content` (nicht gekuerzt — der Mensch muss lesen, was er
    ins Playbook uebernimmt).
  - Eine `<textarea>`, vorbefuellt mit `content`, in der der Text vor dem Annehmen
    editiert werden kann. Der lokale Editierstand wird pro Learning-id gehalten und
    beim Neuladen nur fuer Eintraege zurueckgesetzt, die verschwunden sind — ein
    laufender Poll darf einem Menschen nicht mitten im Tippen den Text ueberschreiben.
  - Button **„Annehmen"** -> `approveLearning(id, editedText.trim())`, deaktiviert bei
    leerem Text und waehrend der Aktion.
  - Button **„Verwerfen"** -> `rejectLearning(id)`.
  - Nach jeder Aktion Liste neu laden und eine kurze Bestaetigung anzeigen
    („Ins Playbook uebernommen." / „Verworfen.").
- Leerzustand: eine ruhige Zeile, z. B. „Keine offenen Learnings." — kein Aufruf zum
  Handeln, das Panel ist ein Postfach.
- Fehler: eine Fehlerzeile wie im Vorbild, das Panel bleibt bedienbar.

## 4. Platzierung

`RecommendationsPanel` wird heute in `App.tsx` (~Zeile 874) gerendert. Setze
`LearningsPanel` **direkt darunter**, mit demselben `projectId`. Wenn dafuer ein
Container in `Sidebar.tsx` sauberer ist, mach es dort — aber halte die visuelle
Reihenfolge „Empfehlungen, dann Learnings" ein.

## 5. `src/components/SettingsView.tsx`

Tab **„Agent-Kategorien"**:

- Pro Kategorie-Zeile ein zusaetzlicher Toggle **„Lernen"**, DB-gestuetzt:
  Stand aus `getLearningSettings()` (fehlender Schluessel = `true`), Schreiben ueber
  `setCategoryLearning(category, enabled)`. Dieser Toggle geht **nicht** mehr durch
  `localStorage` — die bestehenden „Aktiv"- und Default-Profil-Einstellungen bleiben,
  wie sie sind.
- Darunter (oder daneben, wie es ins Layout passt) eine **Profil-Liste** mit einem
  „Aktiv"-Toggle je Profil: Stand aus `AgentProfile.enabled`, Schreiben ueber
  `setProfileEnabled(id, enabled)`, danach `list_agent_profiles` neu laden.
  Beschriftung mit `profile.name`, darunter klein die `profile.id`.
- Ladefehler zeigen wie im Rest der View, keine stillen Fehlschlaege.
- Optimistisches Umschalten ist erlaubt, muss aber bei einem Fehler zurueckspringen.

## 6. `src/components/BoardView.tsx`

Auf Karten in der Spalte `"done"` ein zusaetzlicher kleiner Button **„Learning"**
(Titel/Tooltip: „Learnings aus diesem Lauf destillieren"), der
`runLearningCritic(worker.id)` ausloest. Muster: der bereits vorhandene
`column === "ready_to_merge"`-Button. Waehrend des Laufs deaktiviert; Ergebnis als
kurze Rueckmeldung („N Learnings gefunden." bzw. „Keine Learnings gefunden."), Fehler
ueber denselben Weg wie die anderen Karten-Aktionen. Der Lauf dauert bis zu drei
Minuten — die UI darf dabei nicht blockieren.

## 7. `src/styles.css`

Klassen fuer das Panel, das Pattern-Badge, die Edit-Textarea, den Kategorie-Lern-Toggle
und die Profil-Liste. Bestehende Design-Tokens/Variablen wiederverwenden, keine neuen
Farben erfinden, nichts Bestehendes umbenennen.

## Gates (musst du selbst gruen sehen)

    npm run typecheck
    npm run build

## Abschluss

Kein Commit. Melde per `worker_done` in 3 Saetzen: was du gebaut hast, wie die Gates
stehen, was offen ist.
