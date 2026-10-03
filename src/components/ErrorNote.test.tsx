import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import ErrorNote from "./ErrorNote";

afterEach(cleanup);

describe("ErrorNote", () => {
  it("shows what happened, what to do and the original text in a details block", () => {
    const { container } = render(<ErrorNote message="EACCES: permission denied" />);
    expect(screen.getByText(/Was ist passiert/)).toBeTruthy();
    expect(screen.getByText(/Was du tun kannst/)).toBeTruthy();
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(details?.textContent).toContain("EACCES: permission denied");
  });
});
