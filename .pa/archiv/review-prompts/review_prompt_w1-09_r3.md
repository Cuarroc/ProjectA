# Review-Auftrag: W1-09 (gemergter Stand, frische Nachprüfung)

Du prüfst ein bereits gemergtes Paket des Repos Cuarroc/ProjectA (Tauri 2: Rust mit SQLite-Store, React/TypeScript). Anlass: Zwei Befunde (V5/V6) einer früheren Review-Runde gingen verloren; diese Runde soll unabhängig alles finden, was am gemergten Stand noch falsch, unvollständig oder unbelegt ist.

## Was das Paket leisten sollte (docs/PLAN.md, W1-09)
KI-1, KI-3, KI-6: `LearningsPanel`, `roles.rs::parse_distilled` (Deckel für `system_prompt`), `CommandChat` (Entwurf beim Projektwechsel verwerfen), `refused:`-Präfixe in der UI.

## Einträge aus KNOWN_ISSUES.md
| KI-1 | Rollen-Approve im `LearningsPanel` zeigt den Prompt-Zusatz nicht an (eingeklappt per Default), ist nicht editierbar, und `roles.rs::parse_distilled` deckelt `system_prompt` nicht | mittel | Ein Mensch löst es aus, und der Marker-Schutz (`forbidden_marker`) greift; falsch ist die Behauptung des Kommentars, der Zusatz werde vor dem Verdict gelesen — nicht das Fehlen jedes Schutzes. Der fehlende Cap liegt zudem im Kern, außerhalb des Frontend-Schnitts. |
| KI-3 | Ein in der Kommandoleiste (`CommandChat`) getippter Entwurf überlebt den Projektwechsel und ginge bei Enter an den Orchestrator des neuen Projekts | niedrig | Der Text bleibt sichtbar, das Absenden ist eine Handlung des Nutzers; `ConversationView` löst es per `key={activeProjectId}` bereits richtig. |
| KI-6 | Fehlertexte mit `refused: `-Präfix erreichen die UI wörtlich (z. B. `refused: remote 'origin' already exists`) | niedrig | Preis des einheitlichen Kern-Vokabulars, das 404/409 erst möglich macht; eine Übersetzungsschicht wäre reine Kosmetik. |

## Beweismaßstab des Repos
Jede Verhaltensänderung braucht einen Test, der vor dem Fix rot war. Tests müssen das Verhalten wirklich festhalten (kein trivial wahrer Assert). UI-Elemente brauchen zugängliche Rollen und Namen.

## Deine Aufgabe
Nummeriere Befunde als P1, P2, … mit Schwere (hoch/mittel/niedrig), Datei:Zeile, Begründung und Vorschlag. Prüfe besonders: Korrektheit der Randfälle (Unicode, Rennen beim Projektwechsel, asynchrones Senden), ob die Tests das Verhalten wirklich fangen, Barrierefreiheit, Fehlerpfade. Schließe mit einem Urteil: „keine offenen Punkte“ oder „Folgearbeit nötig“ samt Liste. Erfinde nichts; wenn du dir unsicher bist, sag es.

## Diff (Code, gegen den Stand vor dem Merge)
```diff
diff --git a/src-tauri/src/roles.rs b/src-tauri/src/roles.rs
index 12a5135..0bf1fe9 100644
--- a/src-tauri/src/roles.rs
+++ b/src-tauri/src/roles.rs
@@ -56,6 +56,21 @@ const NAME_MAX: usize = 60;
 /// learnings underneath it.
 const LABEL_MAX: usize = NAME_MAX;
 
+/// How long a distilled `system_prompt` may be, in characters.
+///
+/// Unlike a name or a label, this text is meant to carry substance - it rides
+/// along as a permanent addition to a profile's system prompt in every spawn
+/// that carries the variant (see [`crate::workers::with_role_prompt`]), so it
+/// needs room for more than a phrase. But it is still the least trusted
+/// string in the feature (KI-1): an agent distilled it out of text other
+/// agents wrote, and nothing before this parser bounds its length. Without a
+/// cap a malformed or runaway answer would sit in every future spawn's prompt
+/// unbounded, silently growing what each of them has to read before the task
+/// itself. The bound is generous - well past what a human reviewer would
+/// approve without trimming it - so it catches the pathological case without
+/// tightening the legitimate one.
+const SYSTEM_PROMPT_MAX: usize = 4_000;
+
 /// The separator between the base profile and the variant in a display name.
 /// Part of [`display_name`], and dead for the same reason.
 #[allow(dead_code)]
@@ -329,12 +344,12 @@ pub fn parse_distilled(raw: &str) -> Option<Distilled> {
     }
 
     let name = clip(name.trim(), NAME_MAX);
-    let system_prompt = prompt.trim().to_string();
+    let system_prompt = clip(prompt.trim(), SYSTEM_PROMPT_MAX);
     if name.is_empty() || system_prompt.is_empty() {
         return None;
     }
     // Checked after the clip, so a marker that only survives in the untruncated
-    // name is not what decides this.
+    // name or prompt is not what decides this (KI-1).
     if crate::learnings::forbidden_marker(&name).is_some()
         || crate::learnings::forbidden_marker(&system_prompt).is_some()
     {
@@ -751,6 +766,45 @@ mod tests {
         assert_eq!(parsed.name.chars().count(), NAME_MAX);
     }
 
+    /// KI-1: nothing bounded `system_prompt` before this test. A distiller
+    /// answer that ran on would ride into every future spawn's prompt
+    /// unbounded.
+    #[test]
+    fn a_long_system_prompt_is_capped() {
+        let raw = format!(
+            "NAME: Test-Fixer\nSYSTEM_PROMPT:\n{}\n",
+            "a".repeat(SYSTEM_PROMPT_MAX + 40)
+        );
+        let parsed = parse_distilled(&raw).expect("a proposal");
+        assert_eq!(parsed.system_prompt.chars().count(), SYSTEM_PROMPT_MAX);
+    }
+
+    /// V3 (Review w1-09): the cap must count characters, not bytes. `ä`
+    /// (2 bytes in UTF-8) and an emoji (4 bytes) both far outnumber the char
+    /// count they contribute if the cap were byte-based, so a byte-based
+    /// `clip` would either cut mid-character (a panic on a non-boundary) or
+    /// stop well short of `SYSTEM_PROMPT_MAX` characters.
+    #[test]
+    fn a_long_system_prompt_with_multibyte_characters_is_capped_by_chars() {
+        let filler: String = "ä🙂".repeat((SYSTEM_PROMPT_MAX / 2) + 40);
+        let raw = format!("NAME: Test-Fixer\nSYSTEM_PROMPT:\n{filler}\n");
+        let parsed = parse_distilled(&raw).expect("a proposal");
+        assert_eq!(parsed.system_prompt.chars().count(), SYSTEM_PROMPT_MAX);
+        // 2000 pairs of `ä` (2 bytes) and `🙂` (4 bytes): proves the kept text
+        // really is the multibyte filler, cut on a pair boundary.
+        assert_eq!(parsed.system_prompt.len(), SYSTEM_PROMPT_MAX * 3);
+    }
+
+    /// Review w1-09 (kimi-k3 B4, glm-5.2 B3): a prompt of exactly the cap is
+    /// kept whole, so an off-by-one in `clip` cannot hide.
+    #[test]
+    fn a_system_prompt_of_exactly_the_cap_is_kept_whole() {
+        let prompt = "b".repeat(SYSTEM_PROMPT_MAX);
+        let raw = format!("NAME: Test-Fixer\nSYSTEM_PROMPT:\n{prompt}\n");
+        let parsed = parse_distilled(&raw).expect("a proposal");
+        assert_eq!(parsed.system_prompt, prompt);
+    }
+
     // -- the names ---------------------------------------------------------
 
     #[test]
diff --git a/src/App.tsx b/src/App.tsx
index fb9cfa8..7b6753d 100644
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -1436,6 +1436,7 @@ function AppContent() {
         {goal === "work" && workSurface === "dialog" ? null : (
           <CommandChat
             chat={chat}
+            projectId={activeProjectId}
             onOpenConversation={() => {
               setWorkSurface("dialog");
               setGoal("work");
diff --git a/src/components/CommandChat.test.tsx b/src/components/CommandChat.test.tsx
new file mode 100644
index 0000000..214d04c
--- /dev/null
+++ b/src/components/CommandChat.test.tsx
@@ -0,0 +1,97 @@
+import { act, fireEvent, render, screen } from "@testing-library/react";
+import { describe, expect, it, vi } from "vitest";
+
+import type { OrchestratorChat } from "../lib/orchestratorChat";
+import CommandChat from "./CommandChat";
+
+function makeChat(overrides: Partial<OrchestratorChat> = {}): OrchestratorChat {
+  return {
+    orchestratorId: null,
+    messages: [],
+    loading: false,
+    sending: false,
+    error: null,
+    disabled: false,
+    send: vi.fn(async () => true),
+    clearError: vi.fn(),
+    ...overrides,
+  };
+}
+
+/**
+ * KI-3: a draft typed into the command bar survived a project switch and
+ * would go to the new project's orchestrator on the next Enter.
+ * `ConversationView` already discards its draft on a project switch (via
+ * `key={activeProjectId}` in `App.tsx`); `CommandChat` did not.
+ */
+describe("CommandChat und der Projektwechsel (KI-3)", () => {
+  it("verwirft den ungesendeten Entwurf, wenn die projectId wechselt", () => {
+    const { rerender } = render(
+      <CommandChat
+        chat={makeChat()}
+        projectId="project-a"
+        onOpenConversation={vi.fn()}
+      />,
+    );
+
+    const input = screen.getByLabelText("Aufgabe an den Orchestrator");
+    fireEvent.change(input, { target: { value: "geheimer Entwurf für Projekt A" } });
+    expect(input).toHaveValue("geheimer Entwurf für Projekt A");
+
+    rerender(
+      <CommandChat
+        chat={makeChat()}
+        projectId="project-b"
+        onOpenConversation={vi.fn()}
+      />,
+    );
+
+    expect(screen.getByLabelText("Aufgabe an den Orchestrator")).toHaveValue("");
+  });
+
+  it("behält den Entwurf, solange dieselbe projectId aktiv bleibt", () => {
+    const chat = makeChat();
+    const { rerender } = render(
+      <CommandChat chat={chat} projectId="project-a" onOpenConversation={vi.fn()} />,
+    );
+
+    const input = screen.getByLabelText("Aufgabe an den Orchestrator");
+    fireEvent.change(input, { target: { value: "noch nicht abgeschickt" } });
+
+    // A re-render with the same projectId (e.g. a chat poll landing) must not
+    // wipe what the user is mid-typing.
+    rerender(<CommandChat chat={chat} projectId="project-a" onOpenConversation={vi.fn()} />);
+
+    expect(screen.getByLabelText("Aufgabe an den Orchestrator")).toHaveValue(
+      "noch nicht abgeschickt",
+    );
+  });
+
+  // Review W1-09 (kimi-k3 B5): a send still in flight when the project
+  // switches resolved later and cleared the box unconditionally, so it wiped
+  // the draft already typed for the new project.
+  it("ein spaet bestaetigtes Senden loescht keinen neuen Entwurf", async () => {
+    let resolveSend: (sent: boolean) => void = () => {};
+    const chat = makeChat({
+      send: vi.fn(() => new Promise<boolean>((resolve) => { resolveSend = resolve; })),
+    });
+    const { rerender } = render(
+      <CommandChat chat={chat} projectId="project-a" onOpenConversation={vi.fn()} />,
+    );
+
+    const input = screen.getByLabelText("Aufgabe an den Orchestrator");
+    fireEvent.change(input, { target: { value: "Auftrag für A" } });
+    fireEvent.keyDown(input, { key: "Enter" });
+
+    rerender(<CommandChat chat={chat} projectId="project-b" onOpenConversation={vi.fn()} />);
+    fireEvent.change(screen.getByLabelText("Aufgabe an den Orchestrator"), {
+      target: { value: "Entwurf für B" },
+    });
+
+    await act(async () => {
+      resolveSend(true);
+    });
+
+    expect(screen.getByLabelText("Aufgabe an den Orchestrator")).toHaveValue("Entwurf für B");
+  });
+});
diff --git a/src/components/CommandChat.tsx b/src/components/CommandChat.tsx
index 621c194..ca735c8 100644
--- a/src/components/CommandChat.tsx
+++ b/src/components/CommandChat.tsx
@@ -4,6 +4,15 @@ import { formatMessageTime, roleLabel, type OrchestratorChat } from "../lib/orch
 
 interface CommandChatProps {
   chat: OrchestratorChat;
+  /**
+   * The project this bar is talking about. Not read for its own sake - only
+   * to notice a switch (KI-3): a draft typed here is the user's text for
+   * *this* project, and carrying it into another one's box would send it to
+   * that project's orchestrator on the next Enter. `ConversationView`
+   * discards its draft the same way, just via `key={activeProjectId}` at its
+   * call site; this bar has no such key, so it resets itself instead.
+   */
+  projectId: string | null;
   /** Jump to the full conversation, where the same thread has room to breathe. */
   onOpenConversation: () => void;
 }
@@ -26,10 +35,16 @@ function EmptyChat() {
  * Both read the same `OrchestratorChat`, which lives in `App`, so a view
  * switch never drops the thread.
  */
-export default function CommandChat({ chat, onOpenConversation }: CommandChatProps) {
+export default function CommandChat({ chat, projectId, onOpenConversation }: CommandChatProps) {
   const [text, setText] = useState("");
   const [historyOpen, setHistoryOpen] = useState(false);
 
+  // KI-3: a project switch must not hand the new project's box the old
+  // project's unsent draft.
+  useEffect(() => {
+    setText("");
+  }, [projectId]);
+
   const inputRef = useRef<HTMLTextAreaElement | null>(null);
   const scrollRef = useRef<HTMLDivElement | null>(null);
   // Track whether the user has deliberately scrolled up; if so, new messages
@@ -53,7 +68,9 @@ export default function CommandChat({ chat, onOpenConversation }: CommandChatPro
 
   const handleSend = useCallback(async () => {
     const sent = await chat.send(text);
-    if (sent) setText("");
+    // Clear only what was sent: a project switch while the send was in
+    // flight may already have put a new draft in the box (KI-3).
+    if (sent) setText((current) => (current === text ? "" : current));
     // The user is mid-conversation; the caret belongs back in the field.
     inputRef.current?.focus();
   }, [chat, text]);
diff --git a/src/components/LearningsPanel.roles.test.tsx b/src/components/LearningsPanel.roles.test.tsx
new file mode 100644
index 0000000..913aab1
--- /dev/null
+++ b/src/components/LearningsPanel.roles.test.tsx
@@ -0,0 +1,52 @@
+import { render, screen } from "@testing-library/react";
+import { describe, expect, it, vi } from "vitest";
+
+import LearningsPanel from "./LearningsPanel";
+import * as ipc from "../lib/ipc";
+import type { RoleVariant } from "../types";
+
+vi.mock("../lib/ipc", () => ({
+  approveLearning: vi.fn(),
+  approveRoleVariant: vi.fn(),
+  describeError: (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
+  getVerdictToken: vi.fn(),
+  listLearnings: vi.fn(),
+  listRoleVariants: vi.fn(),
+  rejectLearning: vi.fn(),
+  rejectRoleVariant: vi.fn(),
+}));
+
+const variant: RoleVariant = {
+  id: "variant-1",
+  projectId: "project-a",
+  name: "Test-Fixer",
+  baseProfileId: "claude",
+  patternLabel: "tests-fixen",
+  systemPromptAddition: "Lauf die Gates seriell. Nie CARGO_PROFILE_ setzen.",
+  version: 1,
+  status: "pending",
+  createdAt: 0,
+};
+
+/**
+ * KI-1: the prompt addition a role variant would carry into every future
+ * spawn was folded away by default, so an "Annehmen" click could be a verdict
+ * on text the reviewer never read.
+ */
+describe("LearningsPanel und der Prompt-Zusatz (KI-1)", () => {
+  it("zeigt den Prompt-Zusatz eines Rollen-Vorschlags ohne Klick auf den Tab", async () => {
+    vi.mocked(ipc.listLearnings).mockResolvedValue([]);
+    vi.mocked(ipc.listRoleVariants).mockResolvedValue([variant]);
+
+    render(<LearningsPanel projectId="project-a" />);
+
+    // The tab starts on "Learnings"; the reviewer only has to switch to see
+    // the role card at all — the addition itself must not need a second click.
+    const tab = await screen.findByRole("tab", { name: /Rollen/ });
+    tab.click();
+
+    expect(
+      await screen.findByText("Lauf die Gates seriell. Nie CARGO_PROFILE_ setzen."),
+    ).toBeInTheDocument();
+  });
+});
diff --git a/src/components/LearningsPanel.tsx b/src/components/LearningsPanel.tsx
index 752800c..a92ca66 100644
--- a/src/components/LearningsPanel.tsx
+++ b/src/components/LearningsPanel.tsx
@@ -50,8 +50,13 @@ export default function LearningsPanel({ projectId }: LearningsPanelProps) {
   const [rolesLoaded, setRolesLoaded] = useState(false);
   const [drafts, setDrafts] = useState<Drafts>(() => new Map());
   const [busyId, setBusyId] = useState<string | null>(null);
-  /** Ids whose prompt addition is unfolded; folded is the default. */
-  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
+  /**
+   * Ids whose prompt addition is folded away; unfolded is the default (KI-1).
+   * A verdict is made blind if the addition a variant would carry into every
+   * future spawn is not on screen already - folding it behind a click that a
+   * reviewer must remember to make is how that happens.
+   */
+  const [collapsedPrompts, setCollapsedPrompts] = useState<ReadonlySet<string>>(() => new Set());
   const [notice, setNotice] = useState<string | null>(null);
   const [error, setError] = useState<string | null>(null);
   const [roleError, setRoleError] = useState<string | null>(null);
@@ -92,8 +97,8 @@ export default function LearningsPanel({ projectId }: LearningsPanelProps) {
         (variant) => variant.status === "pending",
       );
       setVariants(next);
-      // A proposal that is gone must not keep an unfolded prompt alive.
-      setExpanded((current) => {
+      // A proposal that is gone must not keep its fold state alive.
+      setCollapsedPrompts((current) => {
         const kept = new Set<string>();
         for (const variant of next) if (current.has(variant.id)) kept.add(variant.id);
         return kept;
@@ -112,7 +117,7 @@ export default function LearningsPanel({ projectId }: LearningsPanelProps) {
       setLearningsLoaded(false);
       setRolesLoaded(false);
       setDrafts(new Map());
-      setExpanded(new Set());
+      setCollapsedPrompts(new Set());
       setNotice(null);
       setError(null);
       setRoleError(null);
@@ -148,8 +153,8 @@ export default function LearningsPanel({ projectId }: LearningsPanelProps) {
   const editText = (id: string, text: string) =>
     setDrafts((current) => new Map(current).set(id, text));
 
-  const toggleExpanded = (id: string) =>
-    setExpanded((current) => {
+  const togglePromptCollapsed = (id: string) =>
+    setCollapsedPrompts((current) => {
       const next = new Set(current);
       if (!next.delete(id)) next.add(id);
       return next;
@@ -374,7 +379,7 @@ export default function LearningsPanel({ projectId }: LearningsPanelProps) {
             <ul className="learn-list">
               {variants.map((variant) => {
                 const pending = busyId === variant.id;
-                const open = expanded.has(variant.id);
+                const open = !collapsedPrompts.has(variant.id);
                 return (
                   <li key={variant.id} className="learn-card role-card">
                     <div className="role-name">{variant.name}</div>
@@ -411,15 +416,27 @@ export default function LearningsPanel({ projectId }: LearningsPanelProps) {
                       type="button"
                       className="worker-action role-prompt-toggle"
                       aria-expanded={open}
+                      aria-controls={open ? `role-prompt-${variant.id}` : undefined}
                       title={open ? "Prompt-Zusatz einklappen" : "Prompt-Zusatz anzeigen"}
-                      onClick={() => toggleExpanded(variant.id)}
+                      onClick={() => togglePromptCollapsed(variant.id)}
                     >
                       {open ? "− Prompt-Zusatz" : "+ Prompt-Zusatz"}
                     </button>
-                    {/* Folded by default: the addition runs long enough to bury
-                        the rest of the card, but it is read before a verdict. */}
+                    {/* Unfolded by default (KI-1): this is what the variant
+                        would add to every future spawn's system prompt, so it
+                        has to be read before the verdict, not after it - the
+                        toggle only lets a reviewer put it away once read, it
+                        must not be what first reveals it. */}
                     {open ? (
-                      <pre className="role-prompt">{variant.systemPromptAddition}</pre>
+                      <pre
+                        id={`role-prompt-${variant.id}`}
+                        className="role-prompt"
+                        role="region"
+                        tabIndex={0}
+                        aria-label="Prompt-Zusatz der Rolle"
+                      >
+                        {variant.systemPromptAddition}
+                      </pre>
                     ) : null}
                     <div className="learn-actions">
                       <button
diff --git a/src/lib/ipc.test.ts b/src/lib/ipc.test.ts
index 555c956..c9edf38 100644
--- a/src/lib/ipc.test.ts
+++ b/src/lib/ipc.test.ts
@@ -1,6 +1,13 @@
 import { beforeEach, describe, expect, it, vi } from "vitest";
 
-import { approveSetupTrust, getOmniRouteUsage, getSetupTrustView, listLiveSessions, openExternal } from "./ipc";
+import {
+  approveSetupTrust,
+  describeError,
+  getOmniRouteUsage,
+  getSetupTrustView,
+  listLiveSessions,
+  openExternal,
+} from "./ipc";
 import { invoke } from "@tauri-apps/api/core";
 
 vi.mock("@tauri-apps/api/core", () => ({
@@ -164,4 +171,22 @@ describe("IPC audit regressions", () => {
       seenTreeOid: "t",
     });
   });
+
+  // KI-6: the core's shared `refused: ` prefix is unified vocabulary for
+  // 404/409 mapping (see api.rs::core_status), not prose for a human — but it
+  // reached the UI verbatim through this single choke point every panel error
+  // goes through.
+  it("KI-6 strips the core's `refused: ` prefix before a message reaches the UI", () => {
+    expect(describeError(new Error("refused: remote 'origin' already exists"))).toBe(
+      "remote 'origin' already exists",
+    );
+    expect(describeError("refused: profile 'kimi' is switched off")).toBe(
+      "profile 'kimi' is switched off",
+    );
+    // Only the leading, exact prefix — a message that merely mentions the
+    // word elsewhere in the sentence is left alone.
+    expect(describeError(new Error("git refused: nothing to commit"))).toBe(
+      "git refused: nothing to commit",
+    );
+  });
 });
diff --git a/src/lib/ipc.ts b/src/lib/ipc.ts
index 623bcda..e58e379 100644
--- a/src/lib/ipc.ts
+++ b/src/lib/ipc.ts
@@ -2182,8 +2182,24 @@ export async function openExternal(url: string): Promise<void> {
   }
 }
 
+/**
+ * The core's shared `refused: ` prefix (see `workers::ERR_REFUSED`) is
+ * routing vocabulary for `api.rs::core_status` to turn into a 409 — it names
+ * no channel a human reads. Stripping it here, at the one place every panel's
+ * error text passes through, keeps that vocabulary intact for the mapping
+ * while a reviewer sees the reason instead of the routing tag it rides on
+ * (KI-6). Only the exact, leading prefix: a message that merely mentions the
+ * word mid-sentence is left as the core wrote it.
+ */
+const REFUSED_PREFIX = "refused: ";
+
 /** Errors coming back over IPC are plain strings as often as they are Errors. */
 export function describeError(error: unknown): string {
+  const message = describeErrorRaw(error);
+  return message.startsWith(REFUSED_PREFIX) ? message.slice(REFUSED_PREFIX.length) : message;
+}
+
+function describeErrorRaw(error: unknown): string {
   if (error instanceof Error) return error.message;
   if (typeof error === "string") return error;
   return JSON.stringify(error);
```
