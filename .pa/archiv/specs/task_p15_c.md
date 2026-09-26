# Phase 15 / Worker C — Rollen-Tab, Varianten im Spawn-Dialog

Status: historisch

Repo: `<repo-root>`, Branch `main`, im Repo-Root (kein Worktree).
**Nicht committen, nicht pushen, nicht mergen.**

## Deine Dateien (EXKLUSIV)

- `src/types.ts`
- `src/lib/ipc.ts`
- `src/components/LearningsPanel.tsx`
- `src/components/NewWorkerDialog.tsx`
- `src/components/ProfilePicker.tsx`
- `src/styles.css`

**Kein Rust.** `src-tauri/**` gehoert Worker A und B, die parallel arbeiten. Die
neuen Tauri-Commands existieren im Backend evtl. noch nicht — das blockiert dich
nicht, `npm run typecheck` und `npm run build` pruefen die Rust-Seite nicht. Halte
dich exakt an die unten fixierten Namen.

Wenn du `App.tsx` anfassen musst (z. B. weil `NewWorkerDialog` von dort Props
bekommt), **melde dich vorher bei mir** per `orca orchestration send --type
escalation` — die Datei ist in dieser Phase niemandem zugeteilt und ich entscheide,
wer sie bekommt. Nutze **kein** blockierendes `ask`, das kommt bei mir nicht an.

## Konventionen

Kommentare **Englisch**, alle **UI-Strings Deutsch**, **keine neuen Dependencies**,
keine Test-Infra im Frontend. Stil strikt wie die Nachbarschaft. Kein
`npm run tauri dev`.

---

## Fixierte Vertraege

    list_role_variants     { projectId }   -> RoleVariant[]   (nur pending + approved)
    approve_role_variant   { id }          -> void
    reject_role_variant    { id }          -> void
    create_worker          { projectId, task, profileId, roleVariantId? } -> Worker

`roleVariantId` ist **optional** — ein Spawn ohne Variante laesst es weg.

## 1. `src/types.ts`

    /** A curated, specialised variant of a base profile, awaiting or past review. */
    export interface RoleVariant {
      id: string;
      projectId: string;
      name: string;
      baseProfileId: string;
      patternLabel: string;
      systemPromptAddition: string;
      version: number;
      status: RoleVariantStatus;
      createdAt: number;
    }

    export type RoleVariantStatus = "pending" | "approved" | "rejected";

## 2. `src/lib/ipc.ts`

Eigener Abschnitt `// -- role variants (Phase 15) ---`, im Stil des
`learnings`-Blocks aus Phase 14: `RawRoleVariant`, eine `toRoleVariant`-Normalisierung
(unbekannter Status -> `"pending"`, fehlende `version` -> `1`, kaputte Eintraege
werden ausgefiltert), dann:

    export async function listRoleVariants(projectId: string): Promise<RoleVariant[]>
    export function approveRoleVariant(id: string): Promise<void>
    export function rejectRoleVariant(id: string): Promise<void>

Ausserdem: die vorhandene `createWorker`-Funktion um ein **optionales**
`roleVariantId` erweitern. Bestehende Aufrufer duerfen sich nicht aendern muessen —
haeng den Parameter hinten an und gib ihn nur weiter, wenn er gesetzt ist.

## 3. `src/components/LearningsPanel.tsx` — Tab "Rollen"

Das Panel bekommt zwei Tabs: **„Learnings"** (das heutige Verhalten, unveraendert)
und **„Rollen"**. Tab-Leiste im Panel-Header, aktiver Tab lokal gehalten. Das
Anzahl-Badge im Header zeigt die Summe der offenen Posten beider Tabs, damit ein
Vorschlag nicht uebersehen wird, weil der falsche Tab aktiv ist.

Tab „Rollen": Karten fuer die Varianten mit `status === "pending"`, je Karte

- der Name, gross,
- das Basis-Profil und das Pattern-Label als Badges,
- `v<version>` als Badge, und bei `version > 1` zusaetzlich der deutliche Hinweis
  **„neue Version"** — der Mensch muss sehen, dass hier etwas Bestehendes abgeloest
  wird,
- der `systemPromptAddition` in einem **auf- und zuklappbaren** Block (zugeklappt per
  Default, der Text ist 5-15 Zeilen lang),
- Buttons **„Annehmen"** / **„Verwerfen"** -> `approveRoleVariant` / `rejectRoleVariant`,
  danach Liste neu laden, kurze Bestaetigung wie im Learnings-Tab.

Leerzustand: „Keine offenen Rollen-Vorschlaege." Fehler wie im Learnings-Tab ueber
`describeError`. Poll-Intervall wie dort (15 s).

## 4. `NewWorkerDialog.tsx` + `ProfilePicker.tsx`

Approved Varianten des aktiven Projekts erscheinen als **eigene, waehlbare Eintraege
unterhalb ihres Basis-Profils**, beschriftet `<Basis> · <Name>` und ab Version 2 mit
` v<version>`, also z. B. `Claude · Test-Fixer v2`. Optisch eingerueckt oder mit einem
Marker, damit die Zugehoerigkeit zum Basis-Profil sichtbar bleibt.

`ProfilePicker` bekommt dafuer die Varianten als zusaetzliche Prop und meldet die
Auswahl so, dass der Aufrufer Basis-Profil **und** optionale Variante erfaehrt.
Erweitere `onPick` entsprechend (z. B. `onPick(profile, variant?)`) statt einen
zweiten Callback einzufuehren.

Wird eine Variante gewaehlt, spawnt `NewWorkerDialog` mit
`profileId = variant.baseProfileId` und `roleVariantId = variant.id`. Ohne Variante
bleibt alles exakt wie heute — insbesondere darf `roleVariantId` dann nicht mitgehen.

Varianten mit `status !== "approved"` tauchen hier **nicht** auf. Ein Vorschlag ist
kein Werkzeug; er wird im Rollen-Tab reviewt, nicht im Spawn-Dialog.

## 5. `src/styles.css`

Klassen fuer die Tab-Leiste, die Rollen-Karte, die Badges (Version, Pattern,
Basis-Profil, „neue Version"), den aufklappbaren Prompt-Block und die eingerueckten
Varianten-Eintraege im Picker. Bestehende Design-Tokens wiederverwenden, keine neuen
Farben erfinden, nichts Bestehendes umbenennen.

## Gates

    npm run typecheck
    npm run build

Beide muessen gruen sein, bevor du fertig meldest. Sie sind billig — lauf sie ruhig
zwischendurch.

## Abschluss

Kein Commit. `worker_done` mit 3 Saetzen: was gebaut, wie die Gates stehen, was offen.
