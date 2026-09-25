import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ActivityView from "./ActivityView";
import * as ipc from "../lib/ipc";

vi.mock("../lib/ipc", () => ({
  describeError: (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
  getActivity: vi.fn(),
  getDigest: vi.fn(),
  listDigests: vi.fn(),
}));

describe("ActivityView claims audit", () => {
  it("X-1 reports a failed activity read instead of rendering the quiet empty state", async () => {
    vi.mocked(ipc.getActivity).mockRejectedValue(new Error("activity unavailable"));

    render(<ActivityView projectId="project-a" />);

    await waitFor(() => expect(ipc.getActivity).toHaveBeenCalled());
    expect(await screen.findByText("activity unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/Hier erscheint, was die Flotte tut/)).not.toBeInTheDocument();
  });
});
