import { act, cleanup, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../Shell", () => ({
  // The content slot appears one tick after the first paint of the shell.
  Shell: () => {
    const [ready, setReady] = useState(false);
    useEffect(() => void setTimeout(() => setReady(true), 0), []);
    return ready ? <main className="g-shell-content" /> : <div />;
  },
}));
vi.mock("../../flags/featureFlags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../flags/featureFlags")>()),
  listFeatureFlags: () => [],
}));

import PreviewToggle from "./PreviewToggle";
import ShellMount from "./ShellMount";

afterEach(cleanup);

describe("shell mount edge cases", () => {
  it("houses the old app when the shell content slot appears after the first render", async () => {
    render(<ShellMount>{() => <p>old app</p>}</ShellMount>);
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))));
    expect(screen.getByText("old app")).toBeInTheDocument();
  });

  it("renders no toggle when the D1 flag is missing from the registry", () => {
    const { container } = render(<PreviewToggle />);
    expect(container).toBeEmptyDOMElement();
  });
});
