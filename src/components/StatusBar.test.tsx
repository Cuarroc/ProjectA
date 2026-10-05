import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { QuotaSnapshot } from "../lib/quota";
import type { TerminalSession } from "../types";
import StatusBar from "./StatusBar";

const quota: QuotaSnapshot = {
  blockedCount: 0,
  omniRouteOnline: false,
} as QuotaSnapshot;

vi.mock("../lib/quota", () => ({
  QUOTA_POLL_MS: 30_000,
  useQuotaState: () => quota,
}));

const SESSION_ID = "0b7e6c1a-5f3d-4d2e-9a41-7c8e2f1b3a90";

function session(overrides: Partial<TerminalSession> = {}): TerminalSession {
  return {
    sessionId: SESSION_ID,
    profileId: "claude",
    profileName: "Claude",
    workerId: null,
    projectId: null,
    kind: "claude",
    title: "Claude",
    exited: false,
    exitCode: null,
    ...overrides,
  } as TerminalSession;
}

function renderBar(current: TerminalSession | null) {
  return render(
    <StatusBar
      session={current}
      error={null}
      attentionCount={0}
      onOpenBoard={vi.fn()}
      onDismissError={vi.fn()}
      onOpenProviders={vi.fn()}
    />,
  );
}

describe("StatusBar calm", () => {
  beforeEach(() => {
    quota.omniRouteOnline = false;
  });

  it("hides the OmniRoute pill unless OmniRoute is online", () => {
    const { container } = renderBar(null);
    expect(container.textContent).not.toContain("OmniRoute");
    quota.omniRouteOnline = null;
    const second = renderBar(null);
    expect(second.container.textContent).not.toContain("OmniRoute");
  });

  it("shows the OmniRoute pill when it is online", () => {
    quota.omniRouteOnline = true;
    renderBar(null);
    expect(screen.getByText("OmniRoute")).toBeInTheDocument();
  });

  it("keeps the session id out of the visible text and shows 'läuft'", () => {
    const { container } = renderBar(session());
    expect(container.textContent).not.toContain(SESSION_ID);
    expect(container.textContent).toContain("läuft");
    expect(screen.getByTitle(SESSION_ID)).toHaveTextContent("Claude");
  });

  it("names the exit code in German", () => {
    renderBar(session({ exited: true, exitCode: 2 }));
    expect(screen.getByText("beendet (Code 2)")).toBeInTheDocument();
  });

  it("says 'keine Sitzung' without a session and no session counter", () => {
    const { container } = renderBar(null);
    expect(screen.getByText("keine Sitzung")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/sessions?\b/);
  });
});
