import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ProviderDialog from "./ProviderDialog";

// F-SEC-4 opt-in (W1-24b): the switch that lets ProjectA hand the vault's
// provider keys to the local OmniRoute process. Off until the user turns it on.

const getOmniRouteKeySync = vi.fn<() => Promise<boolean>>();
const setOmniRouteKeySync = vi.fn<(enabled: boolean) => Promise<void>>();

vi.mock("../lib/ipc", () => ({
  describeError: (cause: unknown) => String(cause),
  deleteProviderKey: vi.fn(async () => {}),
  getFreeTierSummary: vi.fn(() => new Promise(() => {})),
  getOmniRouteKeySync: () => getOmniRouteKeySync(),
  getProviderOverview: vi.fn(async () => []),
  hasProviderKey: vi.fn(async () => false),
  listAgentProfiles: vi.fn(async () => []),
  setOmniRouteKeySync: (enabled: boolean) => setOmniRouteKeySync(enabled),
  setProviderKey: vi.fn(async () => {}),
}));

vi.mock("./FreeTierPanel", () => ({ default: () => null }));

const LABEL = /API-Keys an OmniRoute übergeben/;

describe("ProviderDialog OmniRoute key sync", () => {
  beforeEach(() => {
    getOmniRouteKeySync.mockReset();
    setOmniRouteKeySync.mockReset();
    setOmniRouteKeySync.mockResolvedValue(undefined);
  });

  it("key sync is off by default and warns about the local OmniRoute process", async () => {
    getOmniRouteKeySync.mockResolvedValue(false);
    render(<ProviderDialog onClose={() => {}} />);

    const box = await screen.findByRole("checkbox", { name: LABEL });
    await waitFor(() => expect(getOmniRouteKeySync).toHaveBeenCalled());
    expect(box).not.toBeChecked();
    expect(screen.getByText(/lokalen OmniRoute-Prozess/)).toBeInTheDocument();
    expect(setOmniRouteKeySync).not.toHaveBeenCalled();
  });

  it("enabling key sync stores the opt-in", async () => {
    getOmniRouteKeySync.mockResolvedValue(false);
    render(<ProviderDialog onClose={() => {}} />);

    const box = await screen.findByRole("checkbox", { name: LABEL });
    await waitFor(() => expect(getOmniRouteKeySync).toHaveBeenCalled());
    fireEvent.click(box);

    await waitFor(() => expect(setOmniRouteKeySync).toHaveBeenCalledWith(true));
    expect(box).toBeChecked();
  });

  it("a stored opt-in is shown and can be withdrawn", async () => {
    getOmniRouteKeySync.mockResolvedValue(true);
    render(<ProviderDialog onClose={() => {}} />);

    const box = await screen.findByRole("checkbox", { name: LABEL });
    await waitFor(() => expect(box).toBeChecked());
    fireEvent.click(box);

    await waitFor(() => expect(setOmniRouteKeySync).toHaveBeenCalledWith(false));
    expect(box).not.toBeChecked();
  });

  it("a failed read keeps the box disabled until a refresh answers", async () => {
    getOmniRouteKeySync.mockRejectedValueOnce("store busy").mockResolvedValue(true);
    render(<ProviderDialog onClose={() => {}} />);

    const box = await screen.findByRole("checkbox", { name: LABEL });
    await waitFor(() => expect(screen.getByText("store busy")).toBeInTheDocument());
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();

    const refresh = screen.getByRole("button", { name: "Aktualisieren" });
    await waitFor(() => expect(refresh).not.toBeDisabled());
    fireEvent.click(refresh);

    await waitFor(() => expect(box).toBeChecked());
    expect(box).not.toBeDisabled();
    expect(screen.queryByText("store busy")).not.toBeInTheDocument();
  });

  it("a refresh during a pending write does not overwrite the new choice", async () => {
    // First read: off. The write never settles, and a refresh read that
    // races it still answers with the old value.
    getOmniRouteKeySync.mockResolvedValue(false);
    setOmniRouteKeySync.mockReturnValue(new Promise(() => {}));
    render(<ProviderDialog onClose={() => {}} />);

    const box = await screen.findByRole("checkbox", { name: LABEL });
    await waitFor(() => expect(box).not.toBeDisabled());
    fireEvent.click(box);
    await waitFor(() => expect(setOmniRouteKeySync).toHaveBeenCalledWith(true));

    const refresh = screen.getByRole("button", { name: "Aktualisieren" });
    await waitFor(() => expect(refresh).not.toBeDisabled());
    fireEvent.click(refresh);
    // Let the stale read resolve.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(box).toBeChecked();
  });

  it("a failed write takes the box back", async () => {
    getOmniRouteKeySync.mockResolvedValue(false);
    setOmniRouteKeySync.mockRejectedValue("store locked");
    render(<ProviderDialog onClose={() => {}} />);

    const box = await screen.findByRole("checkbox", { name: LABEL });
    await waitFor(() => expect(getOmniRouteKeySync).toHaveBeenCalled());
    fireEvent.click(box);

    await waitFor(() => expect(screen.getByText("store locked")).toBeInTheDocument());
    expect(box).not.toBeChecked();
  });
});
