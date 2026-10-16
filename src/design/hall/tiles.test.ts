import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

import { FLOOR, TILE } from "./tiles/layout";

it("every tile used by the layout exists in the atlas", () => {
  const atlas: Record<string, unknown> = JSON.parse(readFileSync(join(__dirname, "sprites", "hall-tiles.json"), "utf8"));
  for (const row of FLOOR) {
    expect(row).toHaveLength(FLOOR[0].length);
    for (const c of row) expect(atlas, `${c} → ${TILE[c]}`).toHaveProperty([TILE[c] ?? `unmapped ${c}`]);
  }
});
