import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import DiffView from "./DiffView";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

it("names diff lines while preserving literal hunks navigation drafts and empty files", async () => {
  const files = [
    { path: "src/a.ts", old_path: null, additions: 2, deletions: 1, binary: false, hunks: [
      { header: "@@ -1,2 +1,2 @@", lines: [
        { kind: "context", content: "const stable = '<&>';", old_line: 1, new_line: 1 },
        { kind: "del", content: "const old = 2;", old_line: 2, new_line: null },
        { kind: "add", content: "const next = 3;", old_line: null, new_line: 2 },
      ] },
      { header: "@@ -10,0 +12,1 @@", lines: [
        { kind: "add", content: "export const last = 4;", old_line: null, new_line: 12 },
      ] },
    ] },
    { path: "asset.bin", old_path: null, additions: 0, deletions: 0, binary: true, hunks: [] },
    { path: "empty.txt", old_path: null, additions: 0, deletions: 0, binary: false, hunks: [] },
  ];
  const note = { id: "note", worker_id: "lines-worker", file: "src/a.ts", line: 2,
    body: "Pinned note", sent_to_agent: true, created_at: 1, disposition: "open" };
  let currentFiles = files;
  let refuse: (cause: Error) => void = () => {};
  invoke.mockImplementation((command: string) => {
    if (command === "get_worker_diff") return Promise.resolve({ base_branch: "main", files: currentFiles, stat: "" });
    if (command === "list_diff_comments") return Promise.resolve([note]);
    if (command === "get_worker_readiness") return Promise.resolve({ lifecycle: "exited", readiness: "blocked", blockers: [] });
    if (command === "get_setup_trust_view") return Promise.resolve(null);
    if (command === "add_diff_comment") return new Promise((_, reject) => { refuse = reject; });
    throw new Error(`Unexpected command: ${command}`);
  });
  render(<DiffView workerId="lines-worker" branch="review/lines" />);
  await screen.findByText("const stable = '<&>';");
  const pane = screen.getByRole("region", { name: "Diff-Zeilen" });
  expect(within(pane).getByText("@@ -1,2 +1,2 @@")).toBeInTheDocument();
  expect(within(pane).getByText("@@ -10,0 +12,1 @@")).toBeInTheDocument();
  const content = Array.from(pane.querySelectorAll(".diff-line"), (row) =>
    Array.from(row.querySelectorAll(".diff-gutter, .diff-sign, .diff-text"), (cell) => cell.textContent));
  expect(content).toEqual([
    ["1", "1", " ", "const stable = '<&>';"], ["2", "", "-", "const old = 2;"],
    ["", "2", "+", "const next = 3;"], ["", "12", "+", "export const last = 4;"],
  ]);
  const rows = within(pane).getAllByRole("button");
  expect(rows.map((row) => row.tabIndex)).toEqual([0, -1, -1]);
  expect(within(rows[1]).getByTitle("1 Kommentar(e)")).toBeInTheDocument();
  const deleted = screen.getByText("const old = 2;").closest(".diff-line")!;
  expect(deleted).not.toHaveAttribute("role");
  expect(deleted).not.toHaveAttribute("tabindex");
  fireEvent.click(deleted);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  rows[0].focus();
  for (const [key, index] of [["ArrowDown", 1], ["End", 2], ["ArrowDown", 0], ["ArrowUp", 2], ["Home", 0]] as const) {
    fireEvent.keyDown(document.activeElement!, { key });
    expect(rows[index]).toHaveFocus();
    expect(rows.filter((row) => row.tabIndex === 0)).toEqual([rows[index]]);
  }
  fireEvent.keyDown(rows[0], { key: "Enter" });
  const editor = screen.getByRole("textbox", { name: "Kommentar zu Zeile 1" });
  fireEvent.change(editor, { target: { value: "Keep my draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Datei asset.bin" }));
  expect(within(pane).getByText("Binärdatei — dafür gibt es keinen Textdiff.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Datei empty.txt" }));
  expect(within(pane).getByText("Keine darstellbaren Hunks in dieser Datei.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Datei src/a.ts" }));
  expect(screen.getByRole("textbox")).toHaveValue("Keep my draft");
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("button", { name: "Kommentar zu Zeile 2" }), { key: " " });
  expect(screen.getByRole("textbox")).toHaveValue("");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Pending note" } });
  fireEvent.click(screen.getByRole("button", { name: "Kommentieren" }));
  expect(screen.getByRole("textbox")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Abbrechen" })).toBeDisabled();
  expect(invoke).toHaveBeenCalledWith("add_diff_comment", { workerId: "lines-worker", file: "src/a.ts", line: 2, body: "Pending note" });
  await act(async () => refuse(new Error("Comment refused")));
  expect(screen.getByRole("textbox")).toBeEnabled();
  expect(screen.getByRole("textbox")).toHaveValue("Pending note");
  expect(within(pane).getByText("Comment refused")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
  fireEvent.click(screen.getByRole("button", { name: "Datei asset.bin" }));
  const scroll = vi.fn();
  const original = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = scroll;
  try {
    fireEvent.click(screen.getByRole("button", { name: "Kommentar src/a.ts:2 anzeigen" }));
    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ block: "center" }));
    expect(scroll.mock.instances[0]).toBe(screen.getByRole("button", { name: "Kommentar zu Zeile 2" }));
  } finally {
    HTMLElement.prototype.scrollIntoView = original;
  }
  fireEvent.click(screen.getByRole("button", { name: "Datei asset.bin" }));
  currentFiles = [files[0]];
  fireEvent.click(screen.getByRole("button", { name: "Diff und Readiness neu laden" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Datei asset.bin" })).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Datei src/a.ts" })).toHaveAttribute("aria-current", "true");
  expect(within(pane).getByText("const next = 3;")).toBeInTheDocument();
});
