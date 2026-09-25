import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import DesignStudio from "./DesignStudio";

const getLandingPage = vi.fn();
const setLandingPage = vi.fn();

vi.mock("../lib/ipc", () => ({
  getLandingPage: (...args: unknown[]) => getLandingPage(...args),
  setLandingPage: (...args: unknown[]) => setLandingPage(...args),
  describeError: (cause: unknown) => String(cause),
}));

describe("DesignStudio", () => {
  it("F-4 keeps preview links from navigating the application window", async () => {
    getLandingPage.mockResolvedValue("[extern](https://example.com)");
    render(<DesignStudio projectId="project-a" />);

    const link = await screen.findByRole("link", { name: "extern" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("F2 has no editor and never calls setLandingPage", async () => {
    getLandingPage.mockResolvedValue("# A");
    const { rerender } = render(<DesignStudio projectId="project-a" />);
    expect(await screen.findByRole("heading", { name: "A" })).toBeInTheDocument();

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Speichern" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Markdown-Editor")).not.toBeInTheDocument();

    rerender(<DesignStudio projectId="project-b" />);
    expect(setLandingPage).not.toHaveBeenCalled();
  });

  it("F0-6 copy action uses markdown, not the HTML projection", async () => {
    getLandingPage.mockResolvedValue("[extern](https://example.com)");
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<DesignStudio projectId="project-a" />);
    const button = await screen.findByRole("button", { name: "Markdown kopieren" });
    await waitFor(() => expect(button).toBeEnabled());
    button.click();
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("[extern](https://example.com)"));
    expect(setLandingPage).not.toHaveBeenCalled();
  });
});
