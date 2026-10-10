import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { listRecommendations } from "../lib/ipc";
import type { BoardCard, Recommendation, Worker } from "../types";
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

    const row = await screen.findByRole("option", { name: /Kontingent blockiert/i });
    expect(row).toHaveAccessibleName(/Blockade Kontingent blockiert/);
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

    const inbox = await screen.findByRole("listbox", { name: "Einträge für dich" });
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
    const inbox = await screen.findByRole("listbox", { name: "Einträge für dich" });
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

  it("labels producer codes in German and keeps the wire code in title", async () => {
    vi.mocked(listRecommendations).mockResolvedValue([reco("r1", "Repo X prüfen")]);
    const b = (id: string, code: string) =>
      ({ kind: "blocker" as const, workerId: id, projectId: "pj-1", code, message: code, nextStep: "x", observedAt: 1 });
    render(
      <AttentionInbox
        cards={[]}
        projectId="pj-1"
        blockers={[b("wk-1", "dirty"), b("wk-2", "review_stale"), b("wk-3", "checks_pending")]}
        onOpen={vi.fn()}
      />,
    );
    expect(await screen.findByText("Empfehlung")).toHaveAttribute("title", "recommendation");
    expect(screen.getByText("Uncommittete Dateien")).toHaveAttribute("title", "dirty");
    expect(screen.getByText("Review veraltet")).toHaveAttribute("title", "review_stale");
    expect(screen.getByText("Checks laufen")).toHaveAttribute("title", "checks_pending");
  });

  it("ignores a late recommendation reply for the previous project", async () => {
    let lateReply!: (value: Recommendation[]) => void;
    vi.mocked(listRecommendations).mockImplementation(((id: string) =>
      id === "pj-1"
        ? new Promise<Recommendation[]>((resolve) => {
            lateReply = resolve;
          })
        : Promise.resolve([])) as typeof listRecommendations);

    const view = render(<AttentionInbox cards={[]} projectId="pj-1" onOpen={vi.fn()} />);
    view.rerender(<AttentionInbox cards={[]} projectId="pj-2" onOpen={vi.fn()} />);
    await waitFor(() => expect(listRecommendations).toHaveBeenCalledWith("pj-2"));

    await act(async () => {
      lateReply([
        {
          id: "r1",
          projectId: "pj-1",
          title: "Stale tip",
          url: null,
          rationale: "",
          effort: null,
          status: "new",
          createdAt: 1,
        },
      ]);
    });

    expect(screen.queryByText(/Stale tip/)).toBeNull();
    await waitFor(() => expect(screen.getByText(/Nichts wartet/)).toBeTruthy());
  });
});

function reco(id: string, title: string): Recommendation {
  return {
    id,
    projectId: "pj-1",
    title,
    url: null,
    rationale: "",
    effort: null,
    status: "new",
    createdAt: 1,
  };
}

describe("AttentionInbox request ordering", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the newer poll reply when an older one for the same project lands last", async () => {
    vi.useFakeTimers();
    const replies: Array<(value: Recommendation[]) => void> = [];
    vi.mocked(listRecommendations).mockImplementation((() =>
      new Promise<Recommendation[]>((resolve) => {
        replies.push(resolve);
      })) as typeof listRecommendations);

    render(<AttentionInbox cards={[]} projectId="pj-1" onOpen={vi.fn()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(replies).toHaveLength(2);

    await act(async () => {
      replies[1]([reco("r2", "Fresh tip")]);
    });
    await act(async () => {
      replies[0]([reco("r1", "Stale tip")]);
    });

    expect(screen.queryByText(/Stale tip/)).toBeNull();
    expect(screen.getByText(/Fresh tip/)).toBeTruthy();
  });

  it("ignores a reply that arrives after unmount", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let late!: (value: Recommendation[]) => void;
    vi.mocked(listRecommendations).mockImplementation((() =>
      new Promise<Recommendation[]>((resolve) => {
        late = resolve;
      })) as typeof listRecommendations);

    const view = render(<AttentionInbox cards={[]} projectId="pj-1" onOpen={vi.fn()} />);
    view.unmount();
    await act(async () => {
      late([reco("r1", "Orphan tip")]);
    });
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
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
    const listbox = await screen.findByRole("listbox", { name: "Einträge für dich" });
    expect(listbox).toHaveAttribute("tabindex", "0");
    const options = screen.getAllByRole("option");
    expect(listbox.getAttribute("aria-activedescendant")).toBe(options[0].id);
    expect(options.every((option) => option.parentElement?.getAttribute("role") === "presentation")).toBe(true);
    expect(screen.getByRole("region", { name: "Für dich" })).not.toHaveAttribute("aria-activedescendant");
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    expect(listbox.getAttribute("aria-activedescendant")).toBe(options[1].id);
  });
});
