import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import LiveStatus, { statusSentence } from "./LiveStatus";

describe("statusSentence (APP-11 / APP-20)", () => {
  it("always names the view and adds only the counts that are non-zero", () => {
    expect(statusSentence({ view: "Work", questions: 0, attention: 0 })).toBe("Ansicht Work.");
    expect(statusSentence({ view: "Attention", questions: 1, attention: 0 })).toBe(
      "Ansicht Attention. 1 offene Frage.",
    );
    expect(statusSentence({ view: "Agents", questions: 3, attention: 2 })).toBe(
      "Ansicht Agents. 3 offene Fragen. 2 Worker warten auf dich.",
    );
    expect(statusSentence({ view: "Agents", questions: 0, attention: 1 })).toBe(
      "Ansicht Agents. 1 Worker wartet auf dich.",
    );
  });
});

describe("LiveStatus", () => {
  it("is a single polite, atomic status region that changes its text with the counts", () => {
    const { rerender } = render(<LiveStatus view="Work" questions={0} attention={0} />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("aria-atomic", "true");
    expect(region).toHaveTextContent("Ansicht Work.");
    rerender(<LiveStatus view="Work" questions={2} attention={0} />);
    expect(region).toHaveTextContent("Ansicht Work. 2 offene Fragen.");
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});
