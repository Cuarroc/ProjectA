import { fireEvent, render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { expect, it, vi } from "vitest";
import { reportFrontendError } from "../errors/reportFrontendError";
import { DEV_TEXT } from "../shell/header/texts";
import { FeedbackForm } from "./FeedbackForm";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(true) }));
const info = vi.hoisted(() => ({ sha: "123456789abcdef0", time: "2026-10-12T12:00:00.000Z" }));
vi.mock("./buildInfo", () => ({ buildInfo: () => info }));

it("saves feedback with route and build commit", async () => {
  window.history.replaceState(null, "", "/leitstand");
  reportFrontendError(new Error("kaputt"));
  render(<FeedbackForm />);
  fireEvent.change(screen.getByLabelText(DEV_TEXT.feedbackWhat), { target: { value: "Button tat nichts" } });
  fireEvent.change(screen.getByLabelText(DEV_TEXT.feedbackExpected), { target: { value: "Klick öffnet Menü" } });
  fireEvent.click(screen.getByRole("button", { name: DEV_TEXT.feedbackSubmit }));
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  const feedback = vi.mocked(invoke).mock.calls.find(([, args]) => (args as { kind?: string }).kind === "feedback");
  expect(feedback?.[0]).toBe("log_frontend_error");
  const args = feedback?.[1] as { message: string; stackFrame: string; route: string; context: string };
  expect(args.message).toBe("Button tat nichts");
  expect(args.stackFrame).toBe("Klick öffnet Menü");
  expect(args.route).toBe("/leitstand");
  expect(args.context).toContain('sha="123456789abcdef0"');
  expect(args.context).toContain('at="');
  expect(args.context).toContain("kaputt");
  expect(await screen.findByText(DEV_TEXT.feedbackSaved)).toBeVisible();
});

it("retains the draft until feedback IPC acknowledges submission", async () => {
  vi.mocked(invoke).mockClear();
  let reject!: (error: Error) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  render(<FeedbackForm />);
  fireEvent.change(screen.getByLabelText(DEV_TEXT.feedbackWhat), { target: { value: "Retry me" } });
  fireEvent.click(screen.getByRole("button", { name: DEV_TEXT.feedbackSubmit }));
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole("button")).toBeDisabled();
  reject(new Error("offline"));
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.getByLabelText(DEV_TEXT.feedbackWhat)).toHaveValue("Retry me");
  vi.mocked(invoke).mockResolvedValueOnce(false);
  fireEvent.click(screen.getByRole("button"));
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole("alert")).toBeVisible();
  fireEvent.click(screen.getByRole("button"));
  expect(await screen.findByText(DEV_TEXT.feedbackSaved)).toBeVisible();
});
