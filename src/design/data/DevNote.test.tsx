import { act, render, screen } from "@testing-library/react";
import { getIdentifier } from "@tauri-apps/api/app";
import { afterEach, expect, it, vi } from "vitest";
import { DevNote } from "./DevNote";

vi.mock("@tauri-apps/api/app", () => ({ getIdentifier: vi.fn() }));
afterEach(() => vi.mocked(getIdentifier).mockReset());

const note = "V2-B18 (noch nicht gebaut)";

it("hides the note outside the developer build", async () => {
  for (const identifier of ["com.projecta.app", "com.projecta.dev.other", "", undefined]) {
    vi.mocked(getIdentifier).mockResolvedValue(identifier as string);
    const view = await act(async () => render(<DevNote>{note}</DevNote>));
    expect(view.container).toBeEmptyDOMElement();
    view.unmount();
  }
});

it("shows the note and its styling in the developer build", async () => {
  vi.mocked(getIdentifier).mockResolvedValue("com.projecta.dev");
  render(<DevNote className="og-note">{note}</DevNote>);
  expect(await screen.findByText(note)).toHaveClass("og-note");
});

it("hides the note while the identifier is pending or unavailable", async () => {
  let reject!: (reason: Error) => void;
  vi.mocked(getIdentifier).mockReturnValue(new Promise((_, fail) => { reject = fail; }));
  const { container } = render(<DevNote>{note}</DevNote>);
  expect(container).toBeEmptyDOMElement();
  await act(async () => reject(new Error("identifier unavailable")));
  expect(container).toBeEmptyDOMElement();
});
