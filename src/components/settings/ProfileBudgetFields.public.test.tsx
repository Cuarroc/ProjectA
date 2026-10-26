import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AgentProfile } from "../../types";
import ProfileBudgetFields from "./ProfileBudgetFields";

const profile = (id: string, name: string): AgentProfile => ({
  id,
  name,
  command: id,
  args: [],
  env: {},
  fallback: null,
  enabled: true,
});

const alpha = profile("alpha", "Alpha <Pro>");
const beta = profile("beta", "Beta");

function setup(over: Partial<Parameters<typeof ProfileBudgetFields>[0]> = {}) {
  const onChange = vi.fn();
  const onSave = vi.fn();
  const { rerender } = render(
    <ProfileBudgetFields profile={alpha} budget={{ five: "", seven: "0" }} busy={false} onChange={onChange} onSave={onSave} {...over} />,
  );
  return { onChange, onSave, rerender };
}

describe("ProfileBudgetFields (public)", () => {
  it("keeps a profile budget named while saving and preserves blank versus zero", () => {
    const { onChange, onSave } = setup({ busy: true });
    const group = screen.getByRole("group", { name: "Budget: Alpha <Pro>" });
    const save = within(group).getByRole("button", { name: "Budget" });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute("aria-busy", "true");
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
    expect(within(group).getByLabelText("5 h")).toHaveValue("");
    expect(within(group).getByLabelText("7 T.")).toHaveValue("0");
    fireEvent.change(within(group).getByLabelText("5 h"), { target: { value: "0" } });
    fireEvent.change(within(group).getByLabelText("7 T."), { target: { value: "" } });
    expect(onChange).toHaveBeenNthCalledWith(1, "alpha", { five: "0" });
    expect(onChange).toHaveBeenNthCalledWith(2, "alpha", { seven: "" });
  });

  it("renders one separate group per profile with distinct field ids", () => {
    const common = { busy: false, onChange: vi.fn(), onSave: vi.fn() };
    render(
      <>
        <ProfileBudgetFields profile={alpha} budget={{ five: "10", seven: "20" }} {...common} />
        <ProfileBudgetFields profile={beta} budget={{ five: "30", seven: "40" }} {...common} />
      </>,
    );
    const a = within(screen.getByRole("group", { name: "Budget: Alpha <Pro>" }));
    const b = within(screen.getByRole("group", { name: "Budget: Beta" }));
    expect(a.getByLabelText("5 h")).toHaveValue("10");
    expect(b.getByLabelText("7 T.")).toHaveValue("40");
    expect(a.getByLabelText("5 h").id).not.toBe(b.getByLabelText("5 h").id);
  });

  it("saves the original profile object once per click when idle", () => {
    const { onChange, onSave, rerender } = setup();
    const save = screen.getByRole("button", { name: "Budget" });
    expect(save.tagName).toBe("BUTTON");
    expect(save).toHaveAttribute("type", "button");
    expect(save).toBeEnabled();
    expect(save).not.toHaveAttribute("aria-busy");
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(alpha);
    expect(onSave.mock.calls[0][0]).toBe(alpha);
    rerender(
      <ProfileBudgetFields profile={alpha} budget={{ five: "", seven: "0" }} busy={true} onChange={onChange} onSave={onSave} />,
    );
    const busySave = screen.getByRole("button", { name: "Budget" });
    expect(busySave).toBeDisabled();
    expect(busySave).toHaveAttribute("aria-busy", "true");
    fireEvent.click(busySave);
    fireEvent.click(busySave);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("keeps both fields and the save button focusable while idle", () => {
    const idle = setup();
    const fields = [screen.getByLabelText("5 h"), screen.getByLabelText("7 T.")];
    for (const field of fields) {
      expect(field.tagName).toBe("INPUT");
      expect(field).toHaveProperty("type", "text");
    }
    const focusable = [...fields, screen.getByRole("button", { name: "Budget" })];
    for (const el of focusable) {
      expect(el).toBeEnabled();
      expect(el.tabIndex).toBeGreaterThanOrEqual(0);
      el.focus();
      expect(el).toHaveFocus();
    }
    expect(idle.onSave).not.toHaveBeenCalled();
  });
});
