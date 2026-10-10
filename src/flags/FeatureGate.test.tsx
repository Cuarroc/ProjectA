import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { invoke } from "@tauri-apps/api/core";

import { setFeatureFlagEnabled } from "./featureFlags";
import { FeatureGate } from "./FeatureGate";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

function Probe() {
  useEffect(() => {
    void invoke("feature_gate_probe");
  }, []);
  return <span>gated-child</span>;
}

describe("FeatureGate", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(invoke).mockClear();
  });

  it("hides children and skips invoke when off; shows children when on", () => {
    render(
      <FeatureGate id="fernansicht">
        <Probe />
      </FeatureGate>,
    );
    expect(screen.queryByText("gated-child")).toBeNull();
    expect(invoke).not.toHaveBeenCalled();

    act(() => {
      setFeatureFlagEnabled("fernansicht", true);
    });
    expect(screen.getByText("gated-child")).toBeTruthy();
  });
});
