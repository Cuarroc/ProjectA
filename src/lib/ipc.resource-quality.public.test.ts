import { beforeEach, expect, it, vi } from "vitest";
import { getResourceSnapshot } from "./ipc";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

beforeEach(() => { mocks.invoke.mockReset(); });

it("retains only boolean app data quality and leaves absent or malformed quality unknown", async () => {
  const cases = [
    [{ diskAppPartial: true }, true],
    [{ diskAppPartial: false }, false],
    [{}, null],
    [{ diskAppPartial: null }, null],
    [{ diskAppPartial: "false" }, null],
    [{ diskAppPartial: "true" }, null],
    [{ diskAppPartial: 0 }, null],
    [{ diskAppPartial: 1 }, null],
    [{ diskAppPartial: {} }, null],
    [{ diskAppPartial: [] }, null],
  ] as const;
  for (const [quality, expected] of cases) {
    mocks.invoke.mockResolvedValueOnce({ diskAppBytes: 1610612736, ...quality });
    expect(await getResourceSnapshot()).toMatchObject({ diskAppBytes: 1610612736, diskAppPartial: expected });
  }
  expect(mocks.invoke.mock.calls).toEqual(cases.map(() => ["get_resource_snapshot"]));
});
