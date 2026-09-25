# Review-Auftrag: W1-09b (Folgepaket zu W1-09)

Du prüfst den Branch `claude/w1-09b-followups` des Repos Cuarroc/ProjectA (Tauri 2: Rust mit SQLite-Store, React/TypeScript) gegen `origin/main`. Du hattest keinen Anteil an diesem Code.

## Auftrag des Pakets
Eine frische Nachprüfung von W1-09 (Runde 3, Disposition `.pa/review_w1-09_r3_disposition.md`) hat 8 Befunde angenommen. Dieses Paket setzt sie um:

1. kimi P1: Der Prompt-Zusatz (`systemPromptAddition`) einer Rollenvariante soll vor dem Annehmen editierbar sein; der editierte Text muss durch denselben Deckel und dieselbe Marker-Prüfung wie `roles.rs::parse_distilled`. Das Speichern braucht `store.rs` (neuer Setter) und `main.rs` (Command) – beides Nahtstellen, die in diesem Paket nicht angefasst werden dürfen. Umgesetzt ist nur der nahtfreie Teil: die gemeinsame Prüfung `roles::checked_system_prompt`, die `parse_distilled` jetzt benutzt. Oberfläche und Speichern folgen als eigenes Paket (bewusst keine Editier-UI ohne Speicherpfad: ein Feld, dessen Änderung beim Annehmen verloren geht, wäre schlimmer als keins).
2. kimi P2 / deepseek P2: `CommandChat.tsx` leerte nach dem Senden per Textvergleich; eine späte Bestätigung löschte nach einem Projektwechsel einen neuen, gleichlautenden Entwurf. Fix: Sende-Generation (Ref, zählt Projektwechsel).
3. kimi P3: roter Test zu 2.
4. kimi P4: Wächtertest, dass die Marker-Prüfung nach dem Abschneiden greift.
5. deepseek P3: `describeError` lieferte bei genau `"refused: "` einen leeren Text; jetzt bleibt dann der Originaltext.
6. deepseek P4: `fireEvent.click(tab)` statt `tab.click()` im Test.
7. deepseek P5: Test für den Wechsel auf `projectId = null`.

Abgelehnt (nicht Gegenstand): kimi P5 `tabIndex`, kimi P6 Grapheme, deepseek P1 `aria-controls`.

## Beweismaßstab des Repos
Jede Verhaltensänderung braucht einen Test, der vor dem Fix rot war (für 2 und 5 so geschehen: roter Test-Commit, dann Fix-Commit). Wächtertests für bestehendes Verhalten sind an der Basis grün und als solche ausgewiesen. Tests müssen das Verhalten wirklich festhalten.

## Deine Aufgabe
Nummeriere Befunde als P1, P2, … mit Schwere (hoch/mittel/niedrig), Datei:Zeile, Begründung und Vorschlag. Prüfe besonders: ob die Sende-Generation das Rennen wirklich schließt (auch React StrictMode, doppelte Effekte, Senden ohne Projektwechsel), ob der Refaktor in `roles.rs` Verhalten ändert, ob die Tests das Verhalten fangen, und ob die Abgrenzung von P1 (Nahtteil als Folgepaket) vertretbar ist. Schließe mit einem Urteil: „keine offenen Punkte“ oder „Folgearbeit nötig“ samt Liste. Erfinde nichts; wenn du dir unsicher bist, sag es.

Außerhalb des Code-Diffs enthält der Branch nur die Review-Protokolle der Runde 3 unter `.pa/` (Dokumentation).

## Diff (Code, `git diff origin/main...HEAD -- src src-tauri`)
```diff
diff --git a/src-tauri/src/roles.rs b/src-tauri/src/roles.rs
index 0bf1fe9..05358ea 100644
--- a/src-tauri/src/roles.rs
+++ b/src-tauri/src/roles.rs
@@ -344,23 +344,34 @@ pub fn parse_distilled(raw: &str) -> Option<Distilled> {
     }
 
     let name = clip(name.trim(), NAME_MAX);
-    let system_prompt = clip(prompt.trim(), SYSTEM_PROMPT_MAX);
-    if name.is_empty() || system_prompt.is_empty() {
-        return None;
-    }
-    // Checked after the clip, so a marker that only survives in the untruncated
-    // name or prompt is not what decides this (KI-1).
-    if crate::learnings::forbidden_marker(&name).is_some()
-        || crate::learnings::forbidden_marker(&system_prompt).is_some()
-    {
+    if name.is_empty() || crate::learnings::forbidden_marker(&name).is_some() {
         return None;
     }
+    let system_prompt = checked_system_prompt(&prompt)?;
     Some(Distilled {
         name,
         system_prompt,
     })
 }
 
+/// The one gate every system-prompt addition passes: trimmed, capped at
+/// [`SYSTEM_PROMPT_MAX`] characters, and refused when empty or carrying a
+/// section marker. `None` when it is unusable.
+///
+/// The distiller's answer goes through it in [`parse_distilled`]; a
+/// reviewer's edit of the addition before the verdict (KI-1, "nicht
+/// editierbar") has to go through the same one, so the two can never drift
+/// apart. The marker is checked after the clip: only the clipped text rides
+/// into a spawn, so a marker that only survives in the untruncated text is not
+/// what decides this.
+pub(crate) fn checked_system_prompt(text: &str) -> Option<String> {
+    let system_prompt = clip(text.trim(), SYSTEM_PROMPT_MAX);
+    if system_prompt.is_empty() || crate::learnings::forbidden_marker(&system_prompt).is_some() {
+        return None;
+    }
+    Some(system_prompt)
+}
+
 /// The value of `<field>:` on this line, ignoring case, leading bullets and a
 /// space written where the underscore belongs.
 fn field_value(line: &str, field: &str) -> Option<String> {
@@ -805,6 +816,55 @@ mod tests {
         assert_eq!(parsed.system_prompt, prompt);
     }
 
+    /// Review W1-09 Runde 3 (kimi-k2.6 P4): the marker check runs on the
+    /// clipped prompt, not on the raw answer. Only the clipped text rides into
+    /// a spawn, so a marker the clip cut off cannot re-frame anything and must
+    /// not decide the verdict - while one that survives the clip still does.
+    /// Until now only a comment in `parse_distilled` said so.
+    #[test]
+    fn the_marker_check_runs_on_the_clipped_prompt() {
+        use crate::learnings::TASK_MARKER;
+
+        // Wholly past the cap: cut off, so the proposal stands.
+        let filler = "a".repeat(SYSTEM_PROMPT_MAX);
+        let raw = format!("NAME: Test-Fixer\nSYSTEM_PROMPT:\n{filler}\n{TASK_MARKER}\n");
+        let parsed = parse_distilled(&raw).expect("the marker was clipped away");
+        assert_eq!(parsed.system_prompt, filler);
+
+        // Straddling the cap: only a fragment survives, which is no marker.
+        let head = "a".repeat(SYSTEM_PROMPT_MAX - 4);
+        let raw = format!("NAME: Test-Fixer\nSYSTEM_PROMPT:\n{head}{TASK_MARKER}\n");
+        let parsed = parse_distilled(&raw).expect("only a fragment of the marker survives");
+        assert!(!parsed.system_prompt.contains(TASK_MARKER));
+
+        // Wholly inside the cap: it rides along, so the proposal is refused.
+        let head = "a".repeat(SYSTEM_PROMPT_MAX - TASK_MARKER.chars().count());
+        let raw = format!("NAME: Test-Fixer\nSYSTEM_PROMPT:\n{head}{TASK_MARKER}\nmehr\n");
+        assert_eq!(parse_distilled(&raw), None);
+    }
+
+    /// KI-1 (W1-09b): the gate a reviewer's edit of the addition will pass is
+    /// the same one the distiller's answer passes - trim, cap, marker.
+    #[test]
+    fn an_edited_system_prompt_passes_the_same_gate_as_the_distilled_one() {
+        use crate::learnings::PLAYBOOK_MARKER;
+
+        assert_eq!(
+            checked_system_prompt("  Lauf die Gates seriell.\n"),
+            Some("Lauf die Gates seriell.".to_string())
+        );
+        assert_eq!(checked_system_prompt(" \n\t "), None);
+        assert_eq!(
+            checked_system_prompt(&format!("mach was {PLAYBOOK_MARKER} und was")),
+            None
+        );
+        let long = "c".repeat(SYSTEM_PROMPT_MAX + 1);
+        assert_eq!(
+            checked_system_prompt(&long).map(|kept| kept.chars().count()),
+            Some(SYSTEM_PROMPT_MAX)
+        );
+    }
+
     // -- the names ---------------------------------------------------------
 
     #[test]
diff --git a/src/components/CommandChat.test.tsx b/src/components/CommandChat.test.tsx
index 214d04c..f581f9b 100644
--- a/src/components/CommandChat.test.tsx
+++ b/src/components/CommandChat.test.tsx
@@ -49,6 +49,28 @@ describe("CommandChat und der Projektwechsel (KI-3)", () => {
     expect(screen.getByLabelText("Aufgabe an den Orchestrator")).toHaveValue("");
   });
 
+  // Review W1-09 Runde 3 (deepseek-v4-flash P5): leaving every project is a
+  // switch too - the draft must not wait in the box for the next one.
+  it("verwirft den ungesendeten Entwurf, wenn die projectId auf null wechselt", () => {
+    const { rerender } = render(
+      <CommandChat chat={makeChat()} projectId="project-a" onOpenConversation={vi.fn()} />,
+    );
+
+    fireEvent.change(screen.getByLabelText("Aufgabe an den Orchestrator"), {
+      target: { value: "Entwurf für Projekt A" },
+    });
+
+    rerender(
+      <CommandChat
+        chat={makeChat({ disabled: true })}
+        projectId={null}
+        onOpenConversation={vi.fn()}
+      />,
+    );
+
+    expect(screen.getByLabelText("Aufgabe an den Orchestrator")).toHaveValue("");
+  });
+
   it("behält den Entwurf, solange dieselbe projectId aktiv bleibt", () => {
     const chat = makeChat();
     const { rerender } = render(
@@ -94,4 +116,32 @@ describe("CommandChat und der Projektwechsel (KI-3)", () => {
 
     expect(screen.getByLabelText("Aufgabe an den Orchestrator")).toHaveValue("Entwurf für B");
   });
+
+  // Review W1-09 Runde 3 (kimi-k2.6 P2/P3, deepseek-v4-flash P2): the guard
+  // above compared only the text, so a new draft that happens to read exactly
+  // like the one still in flight was taken for it and wiped.
+  it("ein spaet bestaetigtes Senden loescht auch einen gleichlautenden neuen Entwurf nicht", async () => {
+    let resolveSend: (sent: boolean) => void = () => {};
+    const chat = makeChat({
+      send: vi.fn(() => new Promise<boolean>((resolve) => { resolveSend = resolve; })),
+    });
+    const { rerender } = render(
+      <CommandChat chat={chat} projectId="project-a" onOpenConversation={vi.fn()} />,
+    );
+
+    const input = screen.getByLabelText("Aufgabe an den Orchestrator");
+    fireEvent.change(input, { target: { value: "Tests fixen" } });
+    fireEvent.keyDown(input, { key: "Enter" });
+
+    rerender(<CommandChat chat={chat} projectId="project-b" onOpenConversation={vi.fn()} />);
+    fireEvent.change(screen.getByLabelText("Aufgabe an den Orchestrator"), {
+      target: { value: "Tests fixen" },
+    });
+
+    await act(async () => {
+      resolveSend(true);
+    });
+
+    expect(screen.getByLabelText("Aufgabe an den Orchestrator")).toHaveValue("Tests fixen");
+  });
 });
diff --git a/src/components/CommandChat.tsx b/src/components/CommandChat.tsx
index ca735c8..91f8f6d 100644
--- a/src/components/CommandChat.tsx
+++ b/src/components/CommandChat.tsx
@@ -39,9 +39,16 @@ export default function CommandChat({ chat, projectId, onOpenConversation }: Com
   const [text, setText] = useState("");
   const [historyOpen, setHistoryOpen] = useState(false);
 
+  // Counts project switches. A send remembers the count it started under and
+  // only clears the box if no switch happened since: the text alone cannot
+  // tell a new draft from the one in flight when both read the same
+  // (Review W1-09 Runde 3, kimi-k2.6 P2).
+  const draftGeneration = useRef(0);
+
   // KI-3: a project switch must not hand the new project's box the old
   // project's unsent draft.
   useEffect(() => {
+    draftGeneration.current += 1;
     setText("");
   }, [projectId]);
 
@@ -67,10 +74,14 @@ export default function CommandChat({ chat, projectId, onOpenConversation }: Com
   }, []);
 
   const handleSend = useCallback(async () => {
+    const generation = draftGeneration.current;
     const sent = await chat.send(text);
     // Clear only what was sent: a project switch while the send was in
-    // flight may already have put a new draft in the box (KI-3).
-    if (sent) setText((current) => (current === text ? "" : current));
+    // flight may already have put a new draft in the box (KI-3) - even one
+    // that reads exactly like the text just sent.
+    if (sent && draftGeneration.current === generation) {
+      setText((current) => (current === text ? "" : current));
+    }
     // The user is mid-conversation; the caret belongs back in the field.
     inputRef.current?.focus();
   }, [chat, text]);
diff --git a/src/components/LearningsPanel.roles.test.tsx b/src/components/LearningsPanel.roles.test.tsx
index 913aab1..c199a41 100644
--- a/src/components/LearningsPanel.roles.test.tsx
+++ b/src/components/LearningsPanel.roles.test.tsx
@@ -1,4 +1,4 @@
-import { render, screen } from "@testing-library/react";
+import { fireEvent, render, screen } from "@testing-library/react";
 import { describe, expect, it, vi } from "vitest";
 
 import LearningsPanel from "./LearningsPanel";
@@ -43,7 +43,9 @@ describe("LearningsPanel und der Prompt-Zusatz (KI-1)", () => {
     // The tab starts on "Learnings"; the reviewer only has to switch to see
     // the role card at all — the addition itself must not need a second click.
     const tab = await screen.findByRole("tab", { name: /Rollen/ });
-    tab.click();
+    // fireEvent wraps the click in act(), so the tab switch has settled
+    // before the assertion reads the DOM (Review W1-09 Runde 3, deepseek P4).
+    fireEvent.click(tab);
 
     expect(
       await screen.findByText("Lauf die Gates seriell. Nie CARGO_PROFILE_ setzen."),
diff --git a/src/lib/ipc.test.ts b/src/lib/ipc.test.ts
index c9edf38..e93d902 100644
--- a/src/lib/ipc.test.ts
+++ b/src/lib/ipc.test.ts
@@ -189,4 +189,12 @@ describe("IPC audit regressions", () => {
       "git refused: nothing to commit",
     );
   });
+
+  // Review W1-09 Runde 3 (deepseek-v4-flash P3): a message that is nothing but
+  // the prefix was stripped down to an empty string, and the panel showed an
+  // error with no text at all. The routing tag is still better than nothing.
+  it("KI-6 keeps a bare refused prefix instead of an empty error text", () => {
+    expect(describeError(new Error("refused: "))).toBe("refused: ");
+    expect(describeError("refused:    ")).toBe("refused:    ");
+  });
 });
diff --git a/src/lib/ipc.ts b/src/lib/ipc.ts
index e58e379..f38413b 100644
--- a/src/lib/ipc.ts
+++ b/src/lib/ipc.ts
@@ -2193,10 +2193,17 @@ export async function openExternal(url: string): Promise<void> {
  */
 const REFUSED_PREFIX = "refused: ";
 
-/** Errors coming back over IPC are plain strings as often as they are Errors. */
+/**
+ * Errors coming back over IPC are plain strings as often as they are Errors.
+ *
+ * A message that is nothing but the prefix keeps it: an empty error text
+ * tells the reviewer less than the routing tag does (Review W1-09 Runde 3).
+ */
 export function describeError(error: unknown): string {
   const message = describeErrorRaw(error);
-  return message.startsWith(REFUSED_PREFIX) ? message.slice(REFUSED_PREFIX.length) : message;
+  if (!message.startsWith(REFUSED_PREFIX)) return message;
+  const reason = message.slice(REFUSED_PREFIX.length);
+  return reason.trim() === "" ? message : reason;
 }
 
 function describeErrorRaw(error: unknown): string {
```
