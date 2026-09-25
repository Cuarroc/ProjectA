# Review-Auftrag: W1-11 UIA der ganzen App-Shell

Du bist ein unabhängiger Code-Reviewer für das Repo ProjectA (Tauri 2 + React,
TypeScript). Bewerte den folgenden Commit auf Korrektheit, nicht auf Stil.

## Ursprünglicher Auftrag

PLAN W1-11: `src/components/*` außer `DiffView`/Board-Karte (W1-12) —
Abnahme: Rolle/Name für jedes interaktive Element, gespeicherte
UIA-Baumprüfung als Test. Jedes interaktive Element der App-Shell soll eine
zugängliche Rolle und einen Namen haben (Buttons ohne Text: `aria-label`;
Tabs: `role=tab`/`tablist` mit `aria-selected`/`aria-controls`; Dialoge:
`role=dialog` + `aria-modal` + Name; Eingaben: Label). Verboten: Styles,
Farben, Abstände, Klassen für Optik, CSS/Tokens — nur Semantik/ARIA/Labels.
`DiffView.tsx` und die Board-Karte (W1-12) bleiben unberührt.

## Was der Autor (Claude Code, direkt — kein GLM/Kimi-Durchlauf) tatsächlich
## getan hat

Vor dem Schreiben eines Tests wurde jede Komponente in `src/components/*`
(außer `DiffView.tsx` und der Board-Karte in `BoardView.tsx`) manuell
gegen die Abnahme geprüft: jedes `<button>`, `<input>`, `<textarea>`,
`role="tab"`-Element wurde auf `aria-label`, ein zugehöriges `<label>` oder
sichtbaren Textinhalt untersucht. Befund: die App-Shell erfüllt die Abnahme
bereits durchgehend — keine gefundene Regression, kein Bugfix nötig. Neun
Komponenten (`BoardRail`, `FreeTierPanel`, `HistoryView`, `ProviderDialog`,
`QuestionsView`, `SkillPackDialog`, `StatusBar`, `WorkerPanel`) hatten aber
überhaupt keine Testdatei — nichts hätte eine Regression dort gefangen. Der
Commit fügt für genau diese neun eine einzige neue Testdatei hinzu:
`src/components/ShellAccessibility.test.tsx`. Sie rendert jede der neun
Komponenten mit Testing Library (Hooks/IPC gemockt) und prüft strukturell
(per DOM-Query, nicht per `getByRole`/`toHaveAccessibleName`), dass jedes
`<button>`, `<a href>`, Text-/Passwort-/Such-Eingabe- oder
`<textarea>`-Element sowie jedes `[role=tab]`-Element ein nicht-leeres
`aria-label`, `title` oder `textContent` trägt.

Da kein Produktcode geändert wurde, ist der Test nicht "rot vor dem Fix" —
er war beim ersten Lauf bereits grün. Laut `scripts/lib/test-first.sh`
(`tf_path_is_exempt`) verlangt eine reine `*.test.tsx`-Änderung ohnehin
keinen Test-First/Regression-For/No-Test-Trailer; der Commit trägt daher
keinen.

## Frag dich beim Review insbesondere

1. Stimmt der Befund "bereits konform" — oder hat der Autor ein Muster
   übersehen (z. B. ein `<input>` ohne Label, ein Icon-Button ohne
   `aria-label`, ein `role=tab` ohne Namen) in einer der neun Komponenten
   oder anderswo in der Shell?
2. Ist die DOM-Query-Heuristik in `assertEveryInteractiveElementIsNamed`
   sinnvoll (Selektoren, Rollen-Zuordnung) oder lässt sie eine Lücke offen
   (z. B. `role="switch"`-Buttons, `<select>`, kontrastierende Fälle wo
   `aria-hidden`-Icon-Text fälschlich als Name zählt)?
3. Sind die Mocks (`../lib/providers`, `../lib/quota`, `../lib/skills`,
   `../lib/ipc`) minimal und ungefährlich, oder verstecken sie etwas, das
   ein echter Render zeigen würde?
4. Ist die Entscheidung, keinen Fix zu schreiben und stattdessen nur
   Regressionsschutz hinzuzufügen, im Sinne des Auftrags vertretbar, oder
   hätte hier trotzdem etwas geändert werden müssen?

Antworte mit einer kurzen Liste von Befunden (kritisch / sollte / Anmerkung)
und einem Gesamturteil (freigeben / Nacharbeit nötig).

## Vollständiger Diff (275 Zeilen, ein neues File)

```diff
diff --git a/src/components/ShellAccessibility.test.tsx b/src/components/ShellAccessibility.test.tsx
new file mode 100644
index 0000000..89c3374
--- /dev/null
+++ b/src/components/ShellAccessibility.test.tsx
@@ -0,0 +1,275 @@
+import { render } from "@testing-library/react";
+import { describe, expect, it, vi } from "vitest";
+
+import type { AgentProfile, BoardCard, Project, TerminalSession, Worker } from "../types";
+import type { QuestionsState } from "../lib/useQuestions";
+import BoardRail from "./BoardRail";
+import FreeTierPanel from "./FreeTierPanel";
+import HistoryView from "./HistoryView";
+import ProviderDialog from "./ProviderDialog";
+import QuestionsView from "./QuestionsView";
+import SkillPackDialog from "./SkillPackDialog";
+import StatusBar from "./StatusBar";
+import WorkerPanel from "./WorkerPanel";
+
+// F-W1-11: these nine shell surfaces had no accessibility regression test at
+// all — nothing would fail if a future edit turned one of their buttons back
+// into an icon with no name. This file is that saved accessibility-tree
+// check: every button, link, textbox and tab across them must carry a
+// non-empty accessible name. `InfoLine` and `BootstrapScreen`-style leaf
+// components without interactive elements are not listed; there is nothing
+// here for the check to walk.
+
+vi.mock("../lib/ipc", () => ({
+  listWorkerMessages: vi.fn(async () => []),
+  listAgentProfiles: vi.fn(async () => []),
+  describeError: (cause: unknown) => String(cause),
+}));
+
+vi.mock("../lib/providers", async () => {
+  const actual = await vi.importActual<typeof import("../lib/providers")>("../lib/providers");
+  return {
+    ...actual,
+    useProviderOverview: () => ({
+      providers: [],
+      loading: false,
+      error: null,
+      vaultError: null,
+      refresh: vi.fn(),
+    }),
+    useFreeTierSummary: () => ({
+      summary: null,
+      loading: false,
+      error: null,
+      refresh: vi.fn(),
+    }),
+    useProviderKey: () => ({
+      present: false,
+      busy: false,
+      error: null,
+      save: vi.fn(),
+      remove: vi.fn(),
+      refresh: vi.fn(),
+    }),
+  };
+});
+
+vi.mock("../lib/quota", async () => {
+  const actual = await vi.importActual<typeof import("../lib/quota")>("../lib/quota");
+  return {
+    ...actual,
+    useQuotaState: () => ({
+      byProfile: new Map(),
+      blockedCount: 0,
+      omniRouteOnline: null,
+      loading: false,
+    }),
+  };
+});
+
+vi.mock("../lib/skills", async () => {
+  const actual = await vi.importActual<typeof import("../lib/skills")>("../lib/skills");
+  return {
+    ...actual,
+    useProjectSkillPacks: () => ({
+      packs: [
+        { id: "pack-1", name: "Pack Eins", description: "" },
+        { id: "pack-2", name: "Pack Zwei", description: "" },
+      ],
+      enabled: ["pack-1", "pack-2"],
+      loading: false,
+      error: null,
+      toggle: vi.fn(),
+      saving: false,
+    }),
+  };
+});
+
+function worker(id: string): Worker {
+  return {
+    id,
+    projectId: "pj-1",
+    task: `Task ${id}`,
+    profileId: "codex",
+    branch: `nacht/${id}`,
+    worktreePath: "/tmp/" + id,
+    sessionId: "s1",
+    status: "running",
+    kind: "worker",
+    spawnedBy: null,
+    pausedReason: null,
+    createdAt: 1,
+  };
+}
+
+function card(id: string): BoardCard {
+  return {
+    worker: worker(id),
+    column: "working",
+    attentionReason: null,
+    attentionCode: null,
+    attentionGrade: null,
+    prUrl: null,
+    contextUsage: null,
+    controlledBy: null,
+    testStatus: null,
+    testedAt: null,
+  };
+}
+
+const project: Project = {
+  id: "pj-1",
+  name: "ProjectA",
+  repoPath: "/tmp/pj-1",
+  createdAt: 1,
+  githubRemote: false,
+  maxWorkers: null,
+  testCommand: null,
+};
+
+const profile: AgentProfile = {
+  id: "codex",
+  name: "Codex",
+  command: "codex",
+  args: [],
+  env: {},
+  fallback: null,
+  enabled: true,
+};
+
+const session: TerminalSession = {
+  sessionId: "s1",
+  profileId: "codex",
+  profileName: "Codex",
+  workerId: "wk-1",
+  projectId: "pj-1",
+  kind: "worker",
+  title: "wk-1",
+  exited: false,
+  exitCode: null,
+};
+
+const emptyQuestions: QuestionsState = {
+  open: [],
+  history: [],
+  loading: false,
+  error: null,
+  scope: "project",
+  setScope: vi.fn(),
+  refresh: vi.fn(),
+  answer: vi.fn(async () => undefined),
+};
+
+/** Every allowed accessible-name-bearing role this check walks. */
+const NAMED_ROLES = ["button", "link", "textbox", "tab"] as const;
+
+function assertEveryInteractiveElementIsNamed(container: HTMLElement, label: string) {
+  for (const role of NAMED_ROLES) {
+    const selector =
+      role === "button"
+        ? "button"
+        : role === "link"
+          ? "a[href]"
+          : role === "textbox"
+            ? "input:not([type]), input[type=text], input[type=password], input[type=search], textarea"
+            : '[role="tab"]';
+    const elements = Array.from(container.querySelectorAll<HTMLElement>(selector));
+    for (const element of elements) {
+      const name = element.getAttribute("aria-label") ?? element.textContent ?? "";
+      const describedByTitle = element.getAttribute("title") ?? "";
+      const hasName = name.trim() !== "" || describedByTitle.trim() !== "";
+      expect(
+        hasName,
+        `${label}: ${role} "${element.outerHTML.slice(0, 120)}" has no accessible name`,
+      ).toBe(true);
+    }
+  }
+}
+
+describe("shell accessibility tree — untested surfaces", () => {
+  it("BoardRail names every interactive element", () => {
+    const { container } = render(
+      <BoardRail
+        cards={[card("wk-1"), card("wk-2")]}
+        activeWorkerId={null}
+        hasProject
+        loading={false}
+        error={null}
+        onOpen={vi.fn()}
+        onOpenBoard={vi.fn()}
+        openQuestions={2}
+        questionsFleetWide={false}
+        onOpenQuestions={vi.fn()}
+        onCollapse={vi.fn()}
+      />,
+    );
+    assertEveryInteractiveElementIsNamed(container, "BoardRail");
+  });
+
+  it("FreeTierPanel names every interactive element", () => {
+    const { container } = render(<FreeTierPanel />);
+    assertEveryInteractiveElementIsNamed(container, "FreeTierPanel");
+  });
+
+  it("HistoryView names every interactive element", () => {
+    const { container } = render(<HistoryView workerId="wk-1" />);
+    assertEveryInteractiveElementIsNamed(container, "HistoryView");
+  });
+
+  it("ProviderDialog names every interactive element", () => {
+    const { container } = render(<ProviderDialog onClose={vi.fn()} />);
+    assertEveryInteractiveElementIsNamed(container, "ProviderDialog");
+  });
+
+  it("QuestionsView names every interactive element", () => {
+    const { container } = render(
+      <QuestionsView
+        questions={emptyQuestions}
+        projects={[project]}
+        activeProjectId="pj-1"
+        workers={[worker("wk-1")]}
+        onOpenWorker={vi.fn()}
+      />,
+    );
+    assertEveryInteractiveElementIsNamed(container, "QuestionsView");
+  });
+
+  it("SkillPackDialog names every interactive element", () => {
+    const { container } = render(<SkillPackDialog project={project} onClose={vi.fn()} />);
+    assertEveryInteractiveElementIsNamed(container, "SkillPackDialog");
+  });
+
+  it("StatusBar names every interactive element", () => {
+    const { container } = render(
+      <StatusBar
+        session={session}
+        sessionCount={1}
+        error="Fehler"
+        attentionCount={1}
+        onOpenBoard={vi.fn()}
+        onDismissError={vi.fn()}
+        onOpenProviders={vi.fn()}
+      />,
+    );
+    assertEveryInteractiveElementIsNamed(container, "StatusBar");
+  });
+
+  it("WorkerPanel names every interactive element", () => {
+    const { container } = render(
+      <WorkerPanel
+        workers={[worker("wk-1")]}
+        profiles={[profile]}
+        activeWorkerId={null}
+        hasProject
+        loading={false}
+        error={null}
+        busyWorkerId={null}
+        onNew={vi.fn()}
+        onOpen={vi.fn()}
+        onRespawn={vi.fn()}
+        onArchive={vi.fn()}
+      />,
+    );
+    assertEveryInteractiveElementIsNamed(container, "WorkerPanel");
+  });
+});
```
