import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    localStorage.clear();
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
});
