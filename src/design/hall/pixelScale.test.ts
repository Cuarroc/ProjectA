import { renderHook } from "@testing-library/react";
import { expect, it } from "vitest";

import { pixelScale, usePixelScale } from "./usePixelScale";

it("picks an integer device pixel scale at 125 and 150 percent", () => {
  for (const dpr of [1, 1.25, 1.5]) {
    Object.defineProperty(window, "devicePixelRatio", { value: dpr, configurable: true });
    const { result, unmount } = renderHook(() => usePixelScale());
    expect(Number.isInteger(result.current.device), `dpr ${dpr}`).toBe(true);
    expect(result.current.css * dpr).toBeCloseTo(result.current.device);
    unmount();
  }
  expect(pixelScale(1.25)).toEqual({ device: 3, css: 2.4 });
  expect(pixelScale(1.5)).toEqual({ device: 3, css: 2 });
});
