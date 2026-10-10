import { afterEach, describe, expect, it } from "vitest";

import { RICH_SHOWCASE_COMMANDS, lookupMockResponse } from "./tauriBrowserMock";

describe("tauriBrowserMock rich showcase", () => {
  afterEach(() => {
    delete window.__PROJECTA_E2E_RICH__;
  });

  it("each showcase IPC command resolves in rich mode without throwing", () => {
    expect(RICH_SHOWCASE_COMMANDS).toHaveLength(25);
    for (const command of RICH_SHOWCASE_COMMANDS) {
      expect(
        () => lookupMockResponse(command, true),
        command,
      ).not.toThrow();
    }
  });
});
