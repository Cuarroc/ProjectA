import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

import { de } from "../../i18n/de";
import { FLOOR, TILE } from "./tiles/layout";
import { NAMES } from "./tiles/names";

const atlas: Record<string, unknown> = JSON.parse(readFileSync(join(__dirname, "sprites", "hall-tiles.json"), "utf8"));

it("every tile used by the layout exists in the atlas", () => {
  for (const row of FLOOR) {
    expect(row).toHaveLength(FLOOR[0].length);
    for (const c of row) expect(atlas, `${c} → ${TILE[c]}`).toHaveProperty([TILE[c] ?? `unmapped ${c}`]);
  }
  for (const c of Object.keys(TILE)) expect(FLOOR.join(""), `unused mapping ${c}`).toContain(c);
});

it("there is one station per role", () => {
  const stations = Object.keys(atlas).filter((id) => id.startsWith("station-")).sort();
  expect(stations).toEqual(["build", "check", "ops", "plan"].map((role) => `station-${role}-0`));
});

it("every station gate and prop has a text name", () => {
  const things = Object.keys(atlas).filter((id) => /^(station|gate|prop)-/.test(id));
  expect(things).toContain("gate-hall-0");
  expect(things.some((id) => id.startsWith("prop-"))).toBe(true);
  expect(Object.keys(NAMES).sort()).toEqual(things.sort());
  const words = things.map((id) => de[NAMES[id]]);
  for (const [i, word] of words.entries()) expect(word, things[i]).toMatch(/^\p{Lu}[\p{L} ]+$/u);
  expect(new Set(words).size, "names are unique").toBe(things.length);
});
