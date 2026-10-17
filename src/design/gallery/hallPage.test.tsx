import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { de } from "../../i18n/de";
import { Gallery } from "./Gallery";

// DS-H-07a (ASSETS.md §7-§9): the probe hall page of the gallery. The page switches override the hall only;
// a URL like `#/designsystem?page=hall&motion=lively&set=empty` opens a given mode and set.
const open = (query = "") => {
  window.location.hash = `#/designsystem${query}`;
  const view = render(<Gallery />);
  if (!query) fireEvent.click(within(screen.getByRole("navigation", { name: de["gallery.nav"] })).getByRole("button", { name: de["gallery.family.hall"] }));
  return view;
};
const scene = () => document.querySelector<HTMLElement>(".g-hall__scene")!;
const moving = () => [...document.querySelectorAll("[data-animate]")].map((e) => e.getAttribute("data-sprite"));
const pick = (group: "gallery.hall.motion" | "gallery.hall.set", name: string) => fireEvent.click(within(screen.getByRole("radiogroup", { name: de[group] })).getByRole("radio", { name }));

beforeEach(() => { localStorage.clear(); delete document.documentElement.dataset.motion; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.location.hash = ""; });

describe("gallery probe hall page (DS-H-07a)", () => {
  it("the gallery shows the probe hall with the Beispieldaten label", () => {
    open();
    const hall = screen.getByRole("region", { name: de["hall.title"] });
    expect(within(hall).getByText(de["hall.sample"])).toBeTruthy();
    expect(screen.getByRole("heading", { name: de["gallery.family.hall"] })).toBeTruthy();
  });

  it("the page motion switch sets the hall to lively and off", () => {
    open();
    expect(scene().dataset.motion).toBe("calm");
    pick("gallery.hall.motion", de["gallery.hall.mode.lively"]);
    expect(scene().dataset.motion).toBe("lively");
    expect(moving()).toEqual(["fig-build-run-0"]);
    pick("gallery.hall.motion", de["gallery.hall.mode.off"]);
    expect(scene().dataset.motion).toBe("still");
    expect(moving()).toEqual([]);
    expect(document.documentElement.dataset.motion).toBeUndefined();
  });

  it("OS reduced motion still wins over the page switch", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    open();
    pick("gallery.hall.motion", de["gallery.hall.mode.lively"]);
    expect(scene().dataset.motion).toBe("still");
  });

  it("empty and unread sets show words and no working figure", () => {
    open();
    pick("gallery.hall.set", de["gallery.hall.set.empty"]);
    expect(screen.getByText(de["hall.empty"])).toBeTruthy();
    expect(document.querySelector('[data-sprite*="-run-"]')).toBeNull();
    expect(screen.getByText(de["hall.sample"])).toBeTruthy();
    pick("gallery.hall.set", de["gallery.hall.set.unread"]);
    expect(screen.getByText(de["hall.unread"])).toBeTruthy();
    expect(document.querySelector('[data-sprite^="fig-"]')).toBeNull();
    expect(screen.getByText(de["hall.sample"])).toBeTruthy();
  });

  it("the query opens mode and set", () => {
    open("?page=hall&motion=lively&set=empty");
    expect(screen.getByRole("region", { name: de["hall.title"] })).toBeTruthy();
    expect(scene().dataset.motion).toBe("lively");
    expect(screen.getByText(de["hall.empty"])).toBeTruthy();
    expect(screen.getByRole("radio", { name: de["gallery.hall.mode.lively"], checked: true })).toBeTruthy();
  });

  it("an unknown query value falls back to the defaults", () => {
    open("?page=hall&motion=wild&set=nope");
    expect(scene().dataset.motion).toBe("calm");
    expect(screen.queryByText(de["hall.empty"])).toBeNull();
  });
});
