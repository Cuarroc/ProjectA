import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { Input } from "../inputs/Input";
import { Field } from "./Field";

const renderField = (props: { hint?: string; error?: string } = {}) =>
  render(<Field label="Name" {...props}>{(control) => <Input {...control} />}</Field>);

it("wires label hint and error by id and sets aria-invalid", () => {
  renderField({ hint: "Shown to the team", error: "Required" });
  const input = screen.getByLabelText("Name");
  expect(input).toHaveAttribute("aria-invalid", "true");
  const described = (input.getAttribute("aria-describedby") ?? "").split(" ");
  expect(described).toHaveLength(2);
  expect(described.map((id) => document.getElementById(id)?.textContent)).toEqual(["Shown to the team", "Required"]);
  // The error is text a screen reader announces, not only a red border.
  expect(screen.getByRole("alert")).toHaveTextContent("Required");
});

it("describes only what exists and is valid without an error", () => {
  const { unmount } = renderField({ hint: "Shown to the team" });
  const input = screen.getByLabelText("Name");
  expect(input).not.toHaveAttribute("aria-invalid");
  expect(document.getElementById(input.getAttribute("aria-describedby")!)).toHaveTextContent("Shown to the team");
  expect(screen.queryByRole("alert")).toBeNull();
  unmount();
  renderField();
  expect(screen.getByLabelText("Name")).not.toHaveAttribute("aria-describedby");
});

it("gives two fields different ids", () => {
  render(<><Field label="A">{(c) => <Input {...c} />}</Field><Field label="B">{(c) => <Input {...c} />}</Field></>);
  expect(screen.getByLabelText("A").id).not.toBe(screen.getByLabelText("B").id);
});

it("exposes invalid, filled and focused as state attributes", () => {
  const { container } = renderField({ error: "Required" });
  const root = container.firstElementChild!;
  const input = screen.getByLabelText("Name");
  expect(root).toHaveAttribute("data-invalid");
  expect(root).not.toHaveAttribute("data-filled");
  expect(root).not.toHaveAttribute("data-focused");
  fireEvent.focus(input);
  expect(root).toHaveAttribute("data-focused");
  fireEvent.change(input, { target: { value: "x" } });
  expect(root).toHaveAttribute("data-filled");
  fireEvent.blur(input);
  expect(root).not.toHaveAttribute("data-focused");
  fireEvent.change(input, { target: { value: "" } });
  expect(root).not.toHaveAttribute("data-filled");
});

it("starts filled when the control has a value", () => {
  const { container } = render(<Field label="Name">{(c) => <Input {...c} defaultValue="Ada" />}</Field>);
  expect(container.firstElementChild).toHaveAttribute("data-filled");
});
