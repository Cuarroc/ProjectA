import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getWebInterfaceStatus,
  openExternal,
  startWebInterface,
  stopWebInterface,
} from "../lib/ipc";
import WebInterfacePanel from "./WebInterfacePanel";

vi.mock("../lib/ipc", () => ({
  getWebInterfaceStatus: vi.fn(() => new Promise(() => undefined)),
  startWebInterface: vi.fn(),
  stopWebInterface: vi.fn(),
  openExternal: vi.fn(),
  describeError: (cause: unknown) => String(cause),
}));

describe("WebInterfacePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(getWebInterfaceStatus).mockImplementation(() => new Promise(() => undefined));
  });

  it("C-3 reports an unknown state until the status request answers", () => {
    render(<WebInterfacePanel />);
    expect(screen.queryByText("aus")).not.toBeInTheDocument();
    expect(screen.getByText(/prüft/i)).toBeInTheDocument();
  });

  it("keeps the stopped sidebar to one row without hint text or port field", async () => {
    vi.mocked(getWebInterfaceStatus).mockResolvedValue(null);
    render(<WebInterfacePanel />);

    await screen.findByText("aus");
    expect(screen.getByText("Web-Ansicht")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Starten" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Port")).not.toBeInTheDocument();
    expect(screen.queryByText(/Shows the board|projecta\.db|token/i)).not.toBeInTheDocument();
  });

  it("starts on the stored web port", async () => {
    localStorage.setItem("projecta.settings.webPort", "9123");
    vi.mocked(getWebInterfaceStatus).mockResolvedValue(null);
    vi.mocked(startWebInterface).mockResolvedValue(9123);
    render(<WebInterfacePanel />);

    await screen.findByText("aus");
    fireEvent.click(screen.getByRole("button", { name: "Starten" }));
    await waitFor(() => expect(startWebInterface).toHaveBeenCalledWith(9123));
  });

  it("starts on 8787 when no port is stored", async () => {
    vi.mocked(getWebInterfaceStatus).mockResolvedValue(null);
    vi.mocked(startWebInterface).mockResolvedValue(8787);
    render(<WebInterfacePanel />);

    await screen.findByText("aus");
    fireEvent.click(screen.getByRole("button", { name: "Starten" }));
    await waitFor(() => expect(startWebInterface).toHaveBeenCalledWith(8787));
  });

  it("shows the running chip as the only link and opens /board", async () => {
    vi.mocked(getWebInterfaceStatus).mockResolvedValue(null);
    vi.mocked(startWebInterface).mockResolvedValue(9010);
    vi.mocked(openExternal).mockResolvedValue(undefined);
    render(<WebInterfacePanel />);

    await screen.findByText("aus");
    fireEvent.click(screen.getByRole("button", { name: "Starten" }));

    const chip = await screen.findByRole("button", { name: /läuft · 9010/ });
    expect(screen.queryByRole("button", { name: "/board" })).not.toBeInTheDocument();
    fireEvent.click(chip);
    await waitFor(() => expect(openExternal).toHaveBeenCalledWith("http://localhost:9010/board"));
  });

  it("stops a running interface and returns to the stopped state", async () => {
    vi.mocked(getWebInterfaceStatus).mockResolvedValue(9123);
    vi.mocked(stopWebInterface).mockResolvedValue(undefined);
    render(<WebInterfacePanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Stoppen" }));
    await waitFor(() => expect(stopWebInterface).toHaveBeenCalledOnce());
    expect(await screen.findByRole("button", { name: "Starten" })).toBeInTheDocument();
    expect(screen.getByText("aus")).toBeInTheDocument();
  });

  it("refreshes a status changed by another writer when the document becomes visible", async () => {
    vi.mocked(getWebInterfaceStatus).mockResolvedValueOnce(null).mockResolvedValueOnce(9123);
    render(<WebInterfacePanel />);
    await screen.findByText("aus");
    fireEvent(document, new Event("visibilitychange"));
    expect(await screen.findByRole("button", { name: /läuft · 9123/ })).toBeInTheDocument();
  });
});
