import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRoot: vi.fn(),
  render: vi.fn(),
}));

vi.mock("react-dom/client", () => ({
  default: {
    createRoot: mocks.createRoot,
  },
}));
vi.mock("./App", () => ({ default: () => null }));
vi.mock("./styles.css", () => ({}));

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  mocks.render.mockReset();
  mocks.createRoot.mockReset();
  mocks.createRoot.mockReturnValue({ render: mocks.render });
});

it("mounts the application into the root element", async () => {
  const root = document.getElementById("root");

  await import("./main");

  expect(mocks.createRoot).toHaveBeenCalledWith(root);
  expect(mocks.render).toHaveBeenCalledOnce();
});
