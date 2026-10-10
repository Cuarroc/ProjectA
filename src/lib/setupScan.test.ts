import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { scanSetupRepo, type SetupScan } from "./setupScan";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("scanSetupRepo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls scan_setup_repo with the path and returns the scan unchanged", async () => {
    const scan: SetupScan = {
      mainBranch: "main",
      hasGatesSh: true,
      hasMergify: false,
      hasAgentsMd: true,
      seamFiles: ["src/api.rs"],
      freeRamBytes: null,
    };
    vi.mocked(invoke).mockResolvedValue(scan);
    await expect(scanSetupRepo("/repo")).resolves.toEqual(scan);
    expect(invoke).toHaveBeenCalledWith("scan_setup_repo", { path: "/repo" });
  });

  it("passes the backend's plain refusal through", async () => {
    vi.mocked(invoke).mockRejectedValue("the chosen path is not a folder");
    await expect(scanSetupRepo("/file")).rejects.toBe("the chosen path is not a folder");
  });
});
