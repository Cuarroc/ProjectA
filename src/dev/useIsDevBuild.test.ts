import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useIsDevBuild } from "./useIsDevBuild";

it("accepts only the native dev identifier after it resolves", async () => {
  for (const identifier of ["com.projecta.dev", "com.projecta.app", "com.projecta.dev.other"]) {
    let resolve!: (value: string) => void;
    const pending = new Promise<string>((done) => { resolve = done; });
    const readIdentifier = () => pending;
    const view = renderHook(() => useIsDevBuild(readIdentifier));
    expect(view.result.current).toBe(false);
    await act(async () => resolve(identifier));
    expect(view.result.current).toBe(identifier === "com.projecta.dev");
    view.unmount();
  }
});
