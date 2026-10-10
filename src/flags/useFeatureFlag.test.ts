import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { isFeatureFlagEnabled } from "./featureFlags";
import { useFeatureFlag } from "./useFeatureFlag";

describe("useFeatureFlag", () => {
  beforeEach(() => localStorage.clear());

  it("exposes D1 off by default and toggles persistence", () => {
    const { result } = renderHook(() => useFeatureFlag("d1_neue_oberflaeche"));
    expect(result.current[0]).toBe(false);
    act(() => {
      result.current[1](true);
    });
    expect(result.current[0]).toBe(true);
    expect(isFeatureFlagEnabled("d1_neue_oberflaeche")).toBe(true);
    act(() => {
      result.current[1](false);
    });
    expect(result.current[0]).toBe(false);
    expect(isFeatureFlagEnabled("d1_neue_oberflaeche")).toBe(false);
  });

  it("syncs a second hook when the first toggles the same flag", () => {
    const first = renderHook(() => useFeatureFlag("d1_neue_oberflaeche"));
    const second = renderHook(() => useFeatureFlag("d1_neue_oberflaeche"));
    expect(first.result.current[0]).toBe(false);
    expect(second.result.current[0]).toBe(false);
    act(() => {
      first.result.current[1](true);
    });
    expect(first.result.current[0]).toBe(true);
    expect(second.result.current[0]).toBe(true);
    act(() => {
      second.result.current[1](false);
    });
    expect(first.result.current[0]).toBe(false);
    expect(second.result.current[0]).toBe(false);
  });
});
