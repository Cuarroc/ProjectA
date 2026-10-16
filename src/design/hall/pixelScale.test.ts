import { renderHook } from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it } from "vitest";

import { pixelScale, usePixelScale } from "./usePixelScale";

const original = window.devicePixelRatio;
afterEach(() => {
  Object.defineProperty(window, "devicePixelRatio", { value: original, configurable: true });
});

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

it("server rendering assumes a device pixel ratio of 1", () => {
  Object.defineProperty(window, "devicePixelRatio", { value: 1.5, configurable: true });
  const Probe = () => String(usePixelScale().device);
  expect(renderToString(createElement(Probe))).toBe("2");
});

it("the device pixel ratio override does not leak into later tests", () => {
  expect(window.devicePixelRatio).toBe(original);
});
