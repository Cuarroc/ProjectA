import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CategoriesPanel, { type CategoriesPanelProps } from "./CategoriesPanel";
import type { AgentProfile } from "../../types";

const claude: AgentProfile = {
  id: "claude",
  name: "Claude",
  command: "claude",
  args: [],
  env: {},
  fallback: null,
  enabled: true,
};

function setup(overrides: Partial<CategoriesPanelProps> = {}) {
  const props: CategoriesPanelProps = {
    categories: [
      { id: "worker", active: true, defaultProfileId: "claude" },
      { id: "scout", active: true, defaultProfileId: null },
    ],
    profiles: [claude],
    learning: {},
    learningError: null,
    handleCategoryChange: vi.fn(),
    handleToggleLearning: vi.fn(),
    ...overrides,
  };
  render(<CategoriesPanel {...props} />);
  return props;
}

describe("CategoriesPanel public surface", () => {
  it("names each category learning control and announces the learning error", () => {
    setup({ learningError: "Lernen konnte nicht gespeichert werden." });
    expect(screen.getByRole("switch", { name: "Lernen für Worker" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Lernen für Scout" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Aktiv für Worker" })).toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent("Lernen konnte nicht gespeichert werden.");
  });

  it("shows no alert without an error", () => {
    setup();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps Queen historical and Employee absent", () => {
    setup({
      categories: [
        { id: "queen", active: true, defaultProfileId: "claude" },
        { id: "employee", active: true, defaultProfileId: null },
      ],
    });
    expect(screen.getByLabelText("Queen historisch")).toHaveTextContent("Historisch");
    expect(screen.queryByRole("switch", { name: "Aktiv für Queen" })).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Lernen für Queen" })).toBeInTheDocument();
    expect(screen.getByLabelText("Default Profile für Queen")).toBeDisabled();
    expect(screen.queryByText("Employee")).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /Employee/ })).not.toBeInTheDocument();
  });

  it("disables profile selection for inactive categories and without profiles", () => {
    setup({ categories: [{ id: "worker", active: false, defaultProfileId: null }] });
    expect(screen.getByLabelText("Default Profile für Worker")).toBeDisabled();
  });

  it("disables profile selection when there are no profiles", () => {
    setup({ profiles: [] });
    expect(screen.getByLabelText("Default Profile für Worker")).toBeDisabled();
  });

  it("delegates the exact patch once per interaction and null for no profile", () => {
    const props = setup({ learning: { scout: false } });
    const row = within(screen.getByText("Worker", { selector: ".category-name" }).closest("li")!);

    fireEvent.click(row.getByRole("switch", { name: "Aktiv für Worker" }));
    expect(props.handleCategoryChange).toHaveBeenCalledTimes(1);
    expect(props.handleCategoryChange).toHaveBeenLastCalledWith("worker", { active: false });

    fireEvent.click(row.getByRole("switch", { name: "Lernen für Worker" }));
    expect(props.handleToggleLearning).toHaveBeenCalledTimes(1);
    expect(props.handleToggleLearning).toHaveBeenLastCalledWith("worker", false);

    const scoutLearning = screen.getByRole("switch", { name: "Lernen für Scout" });
    expect(scoutLearning).not.toBeChecked();
    fireEvent.click(scoutLearning);
    expect(props.handleToggleLearning).toHaveBeenCalledTimes(2);
    expect(props.handleToggleLearning).toHaveBeenLastCalledWith("scout", true);

    fireEvent.change(row.getByLabelText("Default Profile für Worker"), { target: { value: "" } });
    expect(props.handleCategoryChange).toHaveBeenCalledTimes(2);
    expect(props.handleCategoryChange).toHaveBeenLastCalledWith("worker", { defaultProfileId: null });
  });
});
