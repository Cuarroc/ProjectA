// DS-H-02a: the probe hall floor in whole tiles (ASSETS.md §1), one character per tile. The belt runs to the
// right, turns down and comes back as the return path; DS-H-04 renders this as one static background.
export const TILE: Readonly<Record<string, string>> = {
  ".": "tile-floor-0", "#": "tile-wall-0", D: "tile-door-0", "=": "tile-belt-0",
  "7": "tile-belt-turn-0", "<": "tile-return-0", J: "tile-return-turn-0",
};

export const FLOOR: readonly string[] = [
  "####D#######",
  "............",
  "............",
  ".=========7.",
  ".<<<<<<<<<J.",
  "............",
];
