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
    expect(screen.getByText(/wird geprüft|unbekannt/i)).toBeInTheDocument();
  });

  it("shows the stored webPort as the start port", () => {
    localStorage.setItem("projecta.settings.webPort", "9123");
    render(<WebInterfacePanel />);
    expect(screen.getByLabelText("Port")).toHaveValue("9123");
  });

  it("rejects invalid ports without asking the core to start", () => {
    render(<WebInterfacePanel />);
    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "70000" } });
    fireEvent.click(screen.getByRole("button", { name: "Starten" }));

    expect(screen.getByText(/zwischen 1 und 65535/)).toBeInTheDocument();
    expect(startWebInterface).not.toHaveBeenCalled();
  });

  it("starts on the requested port and opens both browser destinations", async () => {
    vi.mocked(getWebInterfaceStatus).mockResolvedValue(null);
    vi.mocked(startWebInterface).mockResolvedValue(9010);
    vi.mocked(openExternal).mockResolvedValue(undefined);
    render(<WebInterfacePanel />);

    await screen.findByText("aus");
    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "9000" } });
    fireEvent.click(screen.getByRole("button", { name: "Starten" }));

    await screen.findByText("http://localhost:9010");
    expect(startWebInterface).toHaveBeenCalledWith(9000);
    fireEvent.click(screen.getByRole("button", { name: "http://localhost:9010" }));
    fireEvent.click(screen.getByRole("button", { name: "/board" }));
    await waitFor(() => {
      expect(openExternal).toHaveBeenNthCalledWith(1, "http://localhost:9010");
      expect(openExternal).toHaveBeenNthCalledWith(2, "http://localhost:9010/board");
    });
  });

  it("stops a running interface and returns to the setup hint", async () => {
    vi.mocked(getWebInterfaceStatus).mockResolvedValue(9123);
    vi.mocked(stopWebInterface).mockResolvedValue(undefined);
    render(<WebInterfacePanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Stoppen" }));
    await waitFor(() => expect(stopWebInterface).toHaveBeenCalledOnce());
    expect(await screen.findByRole("button", { name: "Starten" })).toBeInTheDocument();
    expect(screen.getByText(/Shows the board and learnings/)).toBeInTheDocument();
  });
});
