import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import DiffView from "./DiffView";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

const note = { id: "n1", worker_id: "comments-worker", file: "src/a.ts", line: 2,
  body: "Keep this note", sent_to_agent: false, created_at: 1, disposition: "open" };
let accept: (value: typeof note) => void;
let refuse: (cause: Error) => void;

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation((command: string) => {
    if (command === "get_worker_diff") return Promise.resolve({ base_branch: "main", stat: "", files: [
      { path: "src/a.ts", old_path: null, additions: 1, deletions: 0, binary: false, hunks: [
        { header: "@@ -1,1 +1,2 @@", lines: [
          { kind: "context", content: "const stable = 1;", old_line: 1, new_line: 1 },
          { kind: "add", content: "const next = 2;", old_line: null, new_line: 2 },
        ] },
      ] },
    ] });
    if (command === "list_diff_comments") return Promise.resolve([]);
    if (command === "get_worker_readiness") return Promise.resolve({ lifecycle: "exited", readiness: "blocked", blockers: [] });
    if (command === "get_setup_trust_view") return Promise.resolve(null);
    if (command === "add_diff_comment") return new Promise((resolve, reject) => { accept = resolve; refuse = reject; });
    throw new Error(`Unexpected command: ${command}`);
  });
});

async function openEditor() {
  render(<DiffView workerId="comments-worker" branch="review/comments" />);
  fireEvent.click(await screen.findByRole("button", { name: "Kommentar zu Zeile 2" }));
  return screen.getByRole("textbox", { name: "Kommentar zu Zeile 2" });
}

const posts = () => invoke.mock.calls.filter(([command]) => command === "add_diff_comment");

it("keeps the comment action named while posting and associates a refusal with the editor", async () => {
  const editor = await openEditor();
  expect(editor).toHaveFocus();
  fireEvent.change(editor, { target: { value: "  Keep this note  " } });
  const post = screen.getByRole("button", { name: "Kommentieren" });
  fireEvent.click(post);
  expect(screen.getByRole("button", { name: "Kommentieren" })).toBe(post);
  expect(post).toHaveAttribute("aria-busy", "true");
  expect(post).toBeDisabled();
  expect(editor).toBeDisabled();
  expect(screen.getByRole("button", { name: "Abbrechen" })).toBeDisabled();
  fireEvent.click(post);
  fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
  fireEvent.keyDown(editor, { key: "Enter", metaKey: true });
  expect(posts()).toEqual([["add_diff_comment", { workerId: "comments-worker", file: "src/a.ts", line: 2, body: "Keep this note" }]]);

  await act(async () => refuse(new Error("Comment refused")));
  const pane = screen.getByRole("region", { name: "Diff-Zeilen" });
  const alert = within(pane).getByRole("alert");
  expect(alert).toHaveTextContent("Comment refused");
  expect(editor.getAttribute("aria-describedby")?.split(" ")).toContain(alert.id);
  expect(alert.id).not.toBe("");
  expect(editor).toHaveAttribute("aria-invalid", "true");
  expect(editor).toHaveAccessibleDescription("Strg+Enter sendet Comment refused");
  expect(editor).toHaveValue("  Keep this note  ");
  expect(editor).toBeEnabled();
  expect(post).toBeEnabled();
  expect(post).not.toHaveAttribute("aria-busy");
  expect(screen.getByRole("button", { name: "Abbrechen" })).toBeEnabled();

  fireEvent.click(post);
  expect(within(pane).queryByRole("alert")).not.toBeInTheDocument();
  expect(editor).not.toHaveAttribute("aria-invalid");
  await act(async () => accept(note));
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.getByText("Keep this note")).toBeInTheDocument();
  expect(posts()).toHaveLength(2);
});

it("preserves blank guards cancellation and Control or Meta Enter submission", async () => {
  const editor = await openEditor();
  expect(screen.getByRole("button", { name: "Kommentieren" })).toBeDisabled();
  fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
  fireEvent.change(editor, { target: { value: "  \n " } });
  const post = screen.getByRole("button", { name: "Kommentieren" });
  expect(post).toBeDisabled();
  fireEvent.click(post);
  fireEvent.keyDown(editor, { key: "Enter", metaKey: true });
  expect(posts()).toHaveLength(0);
  fireEvent.change(editor, { target: { value: "Discard this" } });
  fireEvent.keyDown(editor, { key: "Escape" });
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  for (const modifier of ["ctrlKey", "metaKey"]) {
    fireEvent.click(screen.getByRole("button", { name: "Kommentar zu Zeile 2" }));
    const next = screen.getByRole("textbox", { name: "Kommentar zu Zeile 2" });
    expect(next).toHaveValue("");
    fireEvent.change(next, { target: { value: "  Keep this note  " } });
    fireEvent.keyDown(next, { key: "Enter" });
    expect(posts()).toHaveLength(modifier === "ctrlKey" ? 0 : 1);
    fireEvent.keyDown(next, { key: "Enter", [modifier]: true });
    expect(posts().at(-1)).toEqual(["add_diff_comment", { workerId: "comments-worker", file: "src/a.ts", line: 2, body: "Keep this note" }]);
    await act(async () => accept({ ...note, id: modifier }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  }
  fireEvent.click(screen.getByRole("button", { name: "Kommentar zu Zeile 2" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Cancel this" } });
  fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(posts()).toHaveLength(2);
});
