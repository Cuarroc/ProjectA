import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { listRecommendations } from "../lib/ipc";
import type { BoardCard, Worker } from "../types";
import AttentionInbox from "./AttentionInbox";

vi.mock("../lib/ipc", () => ({
  listRecommendations: vi.fn(async () => []),
  describeError: (cause: unknown) => String(cause),
}));

function worker(id: string): Worker {
  return {
    id,
    projectId: "pj-1",
    task: id,
    profileId: "codex",
    branch: `nacht/${id}`,
    worktreePath: "/tmp/" + id,
    sessionId: "s1",
    status: "running",
    kind: "worker",
    spawnedBy: null,
    pausedReason: null,
    createdAt: 1,
  };
}

function card(id: string): BoardCard {
  return {
    worker: worker(id),
    column: "needs_you",
    attentionReason: "Kontingent erreicht — Profil wechseln",
    attentionCode: "quota_blocked",
    attentionGrade: "blocking",
    prUrl: null,
    contextUsage: null,
    controlledBy: null,
    testStatus: null,
    testedAt: null,
  };
}

describe("AttentionInbox", () => {
  it("opens the coalesced row and names the code for assistive tech", async () => {
    const onOpen = vi.fn();
    render(
      <AttentionInbox
        cards={[card("wk-1"), card("wk-2"), card("wk-3"), card("wk-4"), card("wk-5")]}
        projectId="pj-1"
        onOpen={onOpen}
      />,
    );

    const row = await screen.findByRole("option", { name: /quota_blocked/i });
    expect(row).toHaveAccessibleName(/Blockade quota_blocked/);
    expect(row).toHaveAccessibleName(/Öffnet Agents/);
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].count).toBe(5);
    expect(onOpen.mock.calls[0][0].goal).toBe("agents");
  });

  it("moves with the keyboard and opens on Enter", async () => {
    const onOpen = vi.fn();
    render(
      <AttentionInbox
        cards={[card("wk-1")]}
        projectId="pj-1"
        blockers={[
          {
            kind: "blocker",
            workerId: "wk-1",
            projectId: "pj-1",
            code: "conflicting",
            message: "Konflikt",
            nextStep: "lösen",
            observedAt: 1,
          },
        ]}
        onOpen={onOpen}
      />,
    );

    const inbox = await screen.findByRole("listbox", { name: "Attention-Einträge" });
    inbox.focus();
    fireEvent.keyDown(inbox, { key: "Enter" });
    await waitFor(() => expect(onOpen).toHaveBeenCalled());
    expect(onOpen.mock.calls[0][0].code).toBe("conflicting");
    fireEvent.keyDown(inbox, { key: "ArrowDown" });
    fireEvent.keyDown(inbox, { key: "Enter" });
    expect(onOpen.mock.calls[1][0].code).toBe("quota_blocked");
  });

  it("jumps with Home and End", async () => {
    const onOpen = vi.fn();
    render(
      <AttentionInbox
        cards={[card("wk-1")]}
        projectId="pj-1"
        blockers={[
          {
            kind: "blocker",
            workerId: "wk-1",
            projectId: "pj-1",
            code: "conflicting",
            message: "Konflikt",
            nextStep: "lösen",
            observedAt: 1,
          },
        ]}
        onOpen={onOpen}
      />,
    );
    const inbox = await screen.findByRole("listbox", { name: "Attention-Einträge" });
    inbox.focus();
    fireEvent.keyDown(inbox, { key: "End" });
    fireEvent.keyDown(inbox, { key: "Enter" });
    expect(onOpen.mock.calls.at(-1)?.[0].code).toBe("quota_blocked");
    fireEvent.keyDown(inbox, { key: "Home" });
    fireEvent.keyDown(inbox, { key: "Enter" });
    expect(onOpen.mock.calls.at(-1)?.[0].code).toBe("conflicting");
  });

  it("names the recommendation error even when the blockers error is an empty string", async () => {
    vi.mocked(listRecommendations).mockRejectedValueOnce(new Error("Kontingent"));
    render(
      <AttentionInbox cards={[]} projectId="pj-1" blockersError="" onOpen={vi.fn()} />,
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Kontingent");
  });
});

describe("AttentionInbox listbox wiring (APP-8)", () => {
  it("the listbox itself is the focus target and names its active option", async () => {
    render(
      <AttentionInbox
        cards={[card("wk-1")]}
        projectId="pj-1"
        blockers={[
          { kind: "blocker", workerId: "wk-1", projectId: "pj-1", code: "conflicting", message: "Konflikt", nextStep: "lösen", observedAt: 1 },
        ]}
        onOpen={vi.fn()}
      />,
    );
    const listbox = await screen.findByRole("listbox", { name: "Attention-Einträge" });
    expect(listbox).toHaveAttribute("tabindex", "0");
    const options = screen.getAllByRole("option");
    expect(listbox.getAttribute("aria-activedescendant")).toBe(options[0].id);
    expect(options.every((option) => option.parentElement?.getAttribute("role") === "presentation")).toBe(true);
    expect(screen.getByRole("region", { name: "Attention-Inbox" })).not.toHaveAttribute("aria-activedescendant");
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    expect(listbox.getAttribute("aria-activedescendant")).toBe(options[1].id);
  });
});
