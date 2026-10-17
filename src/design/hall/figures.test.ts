import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

import { STATE_FORMS, STATE_UNKNOWN_FORM } from "../state/states";
import { POSE_FRAMES, poseFor, ROLE_WORDS, ROLES, type Pose } from "./figures/poses";
import { frames } from "./figures/roles.px";
import { expand, PIXELS, type Frames } from "./sprites/format";

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

// Root findings R1663-ROOT1 and R1666-ROOT1: a figure is the same person in both themes, so neither skin nor
// hair may follow the theme. The palette is read by walking the PNG chunks (length, type, data, crc).
const plte = (theme: string) => {
  const png = readFileSync(join(__dirname, "sprites", `hall-figures-${theme}.png`));
  for (let at = 8; at < png.length; at += 12 + png.readUInt32BE(at)) {
    if (png.toString("latin1", at + 4, at + 8) === "PLTE") {
      return (index: number) => png.subarray(at + 8 + index * 3, at + 11 + index * 3).toString("hex");
    }
  }
  throw new Error(`hall-figures-${theme}.png has no PLTE chunk`);
};

const sameInBothAtlases = (chars: string[]) => {
  const [light, dark] = [plte("light"), plte("dark")];
  for (const char of chars) {
    expect(PIXELS.indexOf(char), "not transparent").toBeGreaterThan(0);
    expect(light(PIXELS.indexOf(char)), `index ${char}`).toBe(dark(PIXELS.indexOf(char)));
  }
};

it("faces keep the same colour in the light and the dark atlas", () => {
  const ready = figures["fig-plan-ready-0"];
  // Row 9 is the face, row 20 a hand (BODY in roles.px.ts); both must hold the skin index.
  sameInBothAtlases([ready[9][13], ready[20][10]]);
});

it("hair keeps the same colour in the light and the dark atlas", () => {
  const plan = figures["fig-plan-ready-0"];
  // Row 7 is the crown, row 9 a sideburn (BODY), row 3 the bun of Planung; none may be the outline or the skin.
  const hair = [plan[7][14], plan[9][11], plan[3][14]];
  expect(new Set(hair).size, "one hair index").toBe(1);
  expect(["1", plan[9][13]]).not.toContain(hair[0]);
  sameInBothAtlases(hair);
});

it("tile atlases do not use the hair or skin slots", () => {
  const skin = PIXELS[15], hair = PIXELS[13];
  const sources = import.meta.glob<{ frames: Frames }>("./tiles/*.px.ts", { eager: true });
  for (const [file, { frames: tiles }] of Object.entries(sources)) {
    for (const [id, raster] of Object.entries(expand(tiles))) expect(raster.join(""), `${file} ${id}`).not.toMatch(new RegExp(`[${hair}${skin}]`));
  }
});
