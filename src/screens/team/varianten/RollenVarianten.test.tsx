import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import * as ipc from "../../../lib/ipc";
import type { RoleVariant } from "../../../types";
import { RollenVarianten } from "./RollenVarianten";

vi.mock("../../../lib/ipc", () => ({
  approveRoleVariant: vi.fn(),
  describeError: (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
  listRoleVariants: vi.fn(),
  rejectRoleVariant: vi.fn(),
}));

const variant = (id: string, extra: Partial<RoleVariant> = {}): RoleVariant => ({
  id,
  projectId: "project-a",
  name: `Rolle ${id}`,
  baseProfileId: "claude",
  patternLabel: "tests-fixen",
  systemPromptAddition: `Zusatz für ${id}.`,
  version: 1,
  status: "pending",
  createdAt: 0,
  ...extra,
});
const row = (name: string) => within(screen.getByRole("article", { name }));
const feed = (rows: RoleVariant[]) => vi.mocked(ipc.listRoleVariants).mockResolvedValue(rows);

beforeEach(() => {
  vi.mocked(ipc.listRoleVariants).mockReset();
  vi.mocked(ipc.approveRoleVariant).mockReset();
  vi.mocked(ipc.rejectRoleVariant).mockReset();
});

it("lists pending variants with the prompt addition visible and leaves out handled ones", async () => {
  feed([variant("a"), variant("b", { status: "approved" }), variant("c", { status: "rejected" })]);
  render(<RollenVarianten projectId="project-a" />);
  expect(await screen.findByRole("article", { name: "Rolle a" })).toBeInTheDocument();
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(row("Rolle a").getByText("Zusatz für a.")).toBeInTheDocument();
  expect(row("Rolle a").getByText("claude")).toBeInTheDocument();
  expect(row("Rolle a").getByText("tests-fixen")).toBeInTheDocument();
  expect(ipc.listRoleVariants).toHaveBeenCalledWith("project-a");
});

it("flags a second version as replacing the one in use", async () => {
  feed([variant("a", { version: 2 }), variant("b")]);
  render(<RollenVarianten projectId="project-a" />);
  await screen.findByRole("article", { name: "Rolle a" });
  expect(row("Rolle a").getByText("neue Version")).toBeInTheDocument();
  expect(row("Rolle b").queryByText("neue Version")).toBeNull();
});

it("approves one variant by id then reloads and says so", async () => {
  vi.mocked(ipc.listRoleVariants).mockResolvedValueOnce([variant("a"), variant("b")]).mockResolvedValue([variant("b")]);
  vi.mocked(ipc.approveRoleVariant).mockResolvedValue(undefined);
  render(<RollenVarianten projectId="project-a" />);
  await screen.findByRole("article", { name: "Rolle a" });
  fireEvent.click(row("Rolle a").getByRole("button", { name: "Annehmen" }));
  await waitFor(() => expect(screen.queryByRole("article", { name: "Rolle a" })).toBeNull());
  expect(ipc.approveRoleVariant).toHaveBeenCalledWith("a");
  expect(ipc.rejectRoleVariant).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent("Rolle angenommen.");
  expect(screen.getByRole("article", { name: "Rolle b" })).toBeInTheDocument();
});

it("rejects one variant by id", async () => {
  vi.mocked(ipc.listRoleVariants).mockResolvedValueOnce([variant("a")]).mockResolvedValue([]);
  vi.mocked(ipc.rejectRoleVariant).mockResolvedValue(undefined);
  render(<RollenVarianten projectId="project-a" />);
  await screen.findByRole("article", { name: "Rolle a" });
  fireEvent.click(row("Rolle a").getByRole("button", { name: "Verwerfen" }));
  expect(await screen.findByText("Keine offenen Rollen-Vorschläge")).toBeInTheDocument();
  expect(ipc.rejectRoleVariant).toHaveBeenCalledWith("a");
  expect(ipc.approveRoleVariant).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent("Vorschlag verworfen.");
});

it("keeps only the working row busy and ignores a second click on it", async () => {
  feed([variant("a"), variant("b")]);
  let finish: () => void = () => {};
  vi.mocked(ipc.approveRoleVariant).mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
  render(<RollenVarianten projectId="project-a" />);
  await screen.findByRole("article", { name: "Rolle a" });
  const approve = row("Rolle a").getByRole("button", { name: "Annehmen" });
  fireEvent.click(approve);
  await waitFor(() => expect(row("Rolle a").getByRole("button", { name: "Läuft …" })).toBeDisabled());
  expect(row("Rolle a").getByRole("button", { name: "Verwerfen" })).toBeDisabled();
  expect(row("Rolle b").getByRole("button", { name: "Annehmen" })).toBeEnabled();
  expect(row("Rolle b").getByRole("button", { name: "Verwerfen" })).toBeEnabled();
  fireEvent.click(row("Rolle a").getByRole("button", { name: "Läuft …" }));
  expect(ipc.approveRoleVariant).toHaveBeenCalledTimes(1);
  finish();
  await waitFor(() => expect(row("Rolle a").getByRole("button", { name: "Annehmen" })).toBeEnabled());
});

it("shows a German error with the reason and frees the row when the verdict fails", async () => {
  feed([variant("a")]);
  vi.mocked(ipc.approveRoleVariant).mockRejectedValue(new Error("Kern nicht erreichbar"));
  render(<RollenVarianten projectId="project-a" />);
  await screen.findByRole("article", { name: "Rolle a" });
  fireEvent.click(row("Rolle a").getByRole("button", { name: "Annehmen" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Annehmen fehlgeschlagen: Kern nicht erreichbar");
  expect(row("Rolle a").getByRole("button", { name: "Annehmen" })).toBeEnabled();
  expect(screen.queryByRole("status")).toBeNull();
});

it("shows the empty state in words", async () => {
  feed([]);
  render(<RollenVarianten projectId="project-a" />);
  expect(await screen.findByText("Keine offenen Rollen-Vorschläge")).toBeInTheDocument();
  expect(screen.queryByRole("article")).toBeNull();
});

it("shows a load error with a retry that loads again", async () => {
  vi.mocked(ipc.listRoleVariants).mockRejectedValueOnce(new Error("offline")).mockResolvedValue([variant("a")]);
  render(<RollenVarianten projectId="project-a" />);
  expect(await screen.findByText("Rollen-Vorschläge konnten nicht geladen werden")).toBeInTheDocument();
  expect(screen.queryByText("Keine offenen Rollen-Vorschläge")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Erneut laden" }));
  expect(await screen.findByRole("article", { name: "Rolle a" })).toBeInTheDocument();
});
