import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { invoke } from "@tauri-apps/api/core";
import { KontingenteScreen } from "../screens/steuerung/KontingenteScreen";
import { VerlaufChat } from "../screens/leitstand/verlauf/VerlaufChat";
import type { OrchestratorChat } from "../lib/orchestratorChat";
import { texts, userError } from "./texts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getIdentifier: async () => "com.projecta.app" }));

const RAW = "browser smoke: unmocked command x";

/** The main message must be the German sentence; the raw text may only sit inside a details element. */
function expectRawOnlyInDetails(raw: string) {
  const hits = screen.getAllByText(raw);
  expect(hits).toHaveLength(1);
  expect(hits[0].closest("details")).not.toBeNull();
}

describe("userError", () => {
  it("maps an unknown raw error to the generic sentence and keeps the raw text as detail", () => {
    expect(userError(RAW)).toEqual({ text: texts.readFailed, detail: RAW });
    expect(userError(RAW, texts.actionFailed).text).toBe(texts.actionFailed);
  });

  it("maps a known error class to its German text", () => {
    expect(userError("request timed out after 30s").text).toBe(texts.timeout);
    expect(userError("connection refused (os error 111)").text).toBe(texts.unreachable);
    expect(userError("database is locked").text).toBe(texts.busy);
  });

  it("falls back without detail for an empty error", () => {
    expect(userError("  ")).toEqual({ text: texts.readFailed, detail: null });
    expect(userError(null)).toEqual({ text: texts.readFailed, detail: null });
  });
});

describe("raw backend errors in the UI", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it("Kontingente shows a user sentence for a failed provider read and keeps the raw text in details", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_provider_overview") throw new Error(RAW);
      return [];
    });
    render(<KontingenteScreen />);
    await waitFor(() => expect(screen.getAllByText(texts.readFailed).length).toBeGreaterThan(0));
    expectRawOnlyInDetails(RAW);
  });

  it("Verlauf chat shows a user sentence for a chat error and keeps the raw text in details", () => {
    const chat: OrchestratorChat = {
      orchestratorId: "w-1", messages: [], loading: false, sending: false, error: RAW, disabled: false,
      send: vi.fn(async () => true), reload: vi.fn(), clearError: vi.fn(),
    };
    render(<VerlaufChat chat={chat} projectId="p-1" />);
    expect(screen.getByText(texts.readFailed)).toBeVisible();
    expectRawOnlyInDetails(RAW);
  });
});
