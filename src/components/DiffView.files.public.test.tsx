import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import DiffView from "./DiffView";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

it("names changed files and retains rename selection counts and comment markers", async () => {
  const files = [
    {
      path: "src/renamed.ts", old_path: "src-tauri/src/store.rs",
      additions: 7, deletions: 3, binary: false,
      hunks: [{ header: "@@ -1 +1 @@", lines: [
        { kind: "add", content: "renamed detail", old_line: null, new_line: 1 },
      ] }],
    },
    {
      path: "src-tauri/src/main.rs", old_path: "docs/old.md",
      additions: 2, deletions: 5, binary: true, hunks: [],
    },
  ];
  const comments = [
    { id: "note-1", worker_id: "files-worker", file: "src/renamed.ts", line: 1,
      body: "Keep this review note", sent_to_agent: true, created_at: 1, disposition: "open" },
    { id: "note-2", worker_id: "files-worker", file: "src/renamed.ts", line: 1,
      body: "Keep the resolved note", sent_to_agent: true, created_at: 2, disposition: "done" },
    { id: "note-3", worker_id: "files-worker", file: "src-tauri/src/main.rs", line: 1,
      body: "Keep the binary note", sent_to_agent: true, created_at: 3, disposition: "open" },
  ];
  let currentFiles = files;
  invoke.mockImplementation(async (command: string) => {
    if (command === "get_worker_diff") return { base_branch: "main", files: currentFiles, stat: "" };
    if (command === "list_diff_comments") return comments;
    if (command === "get_worker_readiness") return { lifecycle: "exited", readiness: "blocked", blockers: [] };
    if (command === "get_setup_trust_view") return null;
    throw new Error(`Unexpected command: ${command}`);
  });
  render(<DiffView workerId="files-worker" branch="review/files" />);
  await screen.findByText("renamed detail");
  const group = screen.getByRole("group", { name: "Geänderte Dateien" });
  const renamed = within(group).getByRole("button", { name: "Datei src-tauri/src/store.rs → src/renamed.ts" });
  const binary = within(group).getByRole("button", { name: "Datei docs/old.md → src-tauri/src/main.rs" });
  expect(within(group).getAllByRole("button")).toHaveLength(2);
  expect(renamed).toHaveAttribute("aria-current", "true");
  expect(renamed).toHaveAttribute("type", "button");
  expect(renamed).toHaveTextContent("src-tauri/src/store.rs → src/renamed.ts");
  expect(within(renamed).getByText("+7")).toBeInTheDocument();
  expect(within(renamed).getByText("-3")).toBeInTheDocument();
  expect(within(renamed).getByText("A")).toHaveAttribute("title", expect.stringContaining("Prüfstufe A:"));
  expect(within(renamed).getByTitle("2 Kommentar(e)")).toHaveTextContent("2");
  expect(within(binary).getByText("+2")).toBeInTheDocument();
  expect(within(binary).getByText("-5")).toBeInTheDocument();
  expect(within(binary).getByText("bin")).toBeInTheDocument();
  expect(within(binary).getByText("A")).toBeInTheDocument();
  expect(within(binary).getByTitle("1 Kommentar(e)")).toHaveTextContent("1");
  fireEvent.click(screen.getByRole("button", { name: "Kommentar zu Zeile 1" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Kommentar zu Zeile 1" }), { target: { value: "Unsent draft" } });
  binary.focus();
  expect(binary).toHaveFocus();
  fireEvent.click(binary);
  expect(binary).toHaveAttribute("aria-current", "true");
  expect(renamed).not.toHaveAttribute("aria-current");
  expect(screen.getByText("Binärdatei — dafür gibt es keinen Textdiff.")).toBeInTheDocument();
  fireEvent.click(renamed);
  expect(screen.getByRole("textbox", { name: "Kommentar zu Zeile 1" })).toHaveValue("Unsent draft");
  fireEvent.click(binary);
  fireEvent.click(screen.getByRole("button", { name: "Diff und Readiness neu laden" }));
  await waitFor(() => expect(invoke.mock.calls.filter(([cmd]) => cmd === "get_worker_diff")).toHaveLength(2));
  expect(binary).toHaveAttribute("aria-current", "true");
  currentFiles = [files[0]];
  fireEvent.click(screen.getByRole("button", { name: "Diff und Readiness neu laden" }));
  await waitFor(() => expect(within(group).getAllByRole("button")).toHaveLength(1));
  expect(renamed).toHaveAttribute("aria-current", "true");
  expect(screen.getByRole("textbox", { name: "Kommentar zu Zeile 1" })).toHaveValue("Unsent draft");
  expect(screen.getByText("Keep this review note")).toBeInTheDocument();
  expect(screen.getByText("Keep the resolved note")).toBeInTheDocument();
  expect(screen.getByText("Keep the binary note")).toBeInTheDocument();
  expect(invoke).toHaveBeenCalledWith("get_worker_diff", { workerId: "files-worker" });
  expect(invoke).toHaveBeenCalledWith("list_diff_comments", { workerId: "files-worker" });
  expect(invoke.mock.calls.every(([cmd]) => ["get_worker_diff", "list_diff_comments", "get_worker_readiness", "get_setup_trust_view"].includes(cmd))).toBe(true);
});
