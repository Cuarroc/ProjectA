import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

import { STATE_FORMS, STATE_UNKNOWN_FORM } from "../state/states";
import { POSE_FRAMES, poseFor, ROLE_WORDS, ROLES, type Pose } from "./figures/poses";
import { frames } from "./figures/roles.px";
import { expand, PIXELS } from "./sprites/format";

const figures = expand(frames);
const POSES = Object.keys(POSE_FRAMES) as Pose[];
const SOURCES = [...STATE_FORMS, STATE_UNKNOWN_FORM];

it("every pose maps to exactly one StateForm or unknown", () => {
  expect([...POSES].sort()).toEqual([...SOURCES, "ready"].sort());
  for (const pose of POSES.filter((p) => p !== "ready")) expect(SOURCES.filter((f) => poseFor(f) === pose), pose).toHaveLength(1);
});

it("every state form and unknown maps to exactly one pose", () => {
  for (const form of SOURCES) expect(POSES).toContain(poseFor(form));
  // A value outside the six forms is never guessed; the stance `ready` needs that no run is observed.
  expect(poseFor("stalled")).toBe("unknown");
  expect(poseFor(null)).toBe("ready");
});

it("every role has a frame for every pose", () => {
  const ids = ROLES.flatMap((r) => POSES.flatMap((p) => Array.from({ length: POSE_FRAMES[p] }, (_, i) => `fig-${r}-${p}-${i}`)));
  expect(Object.keys(figures).sort()).toEqual(ids.sort());
  expect(ids.length / ROLES.length).toBeLessThanOrEqual(12);
});

it("no figure frame uses more than eight colours", () => {
  for (const [id, rows] of Object.entries(figures)) expect(new Set(rows.join("").replaceAll(".", "")).size, id).toBeLessThanOrEqual(8);
});

it("unknown never shows the working pose", () => {
  for (const r of ROLES) for (const i of [0, 1]) expect(figures[`fig-${r}-unknown-0`]).not.toEqual(figures[`fig-${r}-run-${i}`]);
});

it("the four roles differ by silhouette and not only by colour", () => {
  const masks = ROLES.map((r) => figures[`fig-${r}-ready-0`].join("").replace(/[^.]/g, "#"));
  expect(new Set(masks).size).toBe(ROLES.length);
});

it("role is also text", () => {
  expect(ROLES.map((r) => ROLE_WORDS[r])).toEqual(["Planung", "Umsetzung", "Prüfung", "Betrieb"]);
});

// Root finding R1663-ROOT1: a figure is the same person in both themes, so skin may not follow the theme.
const plte = (theme: string) => {
  const png = readFileSync(join(__dirname, "sprites", `hall-figures-${theme}.png`));
  const at = png.indexOf("PLTE") + 4;
  return (index: number) => png.subarray(at + index * 3, at + index * 3 + 3).toString("hex");
};

it("faces keep the same colour in the light and the dark atlas", () => {
  const [light, dark] = [plte("light"), plte("dark")];
  const ready = figures["fig-plan-ready-0"];
  // Row 9 is the face, row 20 a hand (BODY in roles.px.ts); both must hold the skin index.
  for (const char of [ready[9][13], ready[20][10]]) {
    expect(PIXELS.indexOf(char), "skin is not transparent").toBeGreaterThan(0);
    expect(light(PIXELS.indexOf(char)), `index ${char}`).toBe(dark(PIXELS.indexOf(char)));
  }
});
