import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getEmergencyStop, setEmergencyStop } from "../../lib/ipc";
import { StopBand } from "./StopBand";

vi.mock("../../lib/ipc", () => ({
  getEmergencyStop: vi.fn(),
  setEmergencyStop: vi.fn(),
  describeError: String,
}));

const stopped = vi.mocked(getEmergencyStop);
const resumeStop = vi.mocked(setEmergencyStop);

beforeEach(() => {
  stopped.mockReset().mockResolvedValue(true);
  resumeStop.mockReset();
});
afterEach(cleanup);

describe("stop band resume in flight", () => {
  it("ignores a second Fortsetzen click until the first resume settles and then allows a retry", async () => {
    let rejectFirst: (reason: unknown) => void = () => {};
    resumeStop.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }));
    resumeStop.mockImplementation(() => new Promise(() => {}));

    await act(async () => void render(<StopBand />));
    const fortsetzen = () => fireEvent.click(screen.getByRole("button", { name: "Fortsetzen" }));
    await act(async () => void fortsetzen());
    await act(async () => void fortsetzen());
    expect(resumeStop).toHaveBeenCalledTimes(1);
    expect(resumeStop).toHaveBeenCalledWith(false);

    await act(async () => { rejectFirst("kein Zugriff"); });
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("kein Zugriff");

    resumeStop.mockResolvedValue(undefined);
    await act(async () => void fortsetzen());
    expect(resumeStop).toHaveBeenCalledTimes(2);
    expect(resumeStop).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
