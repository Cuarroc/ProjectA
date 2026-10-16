import type { MessageKey } from "../../../i18n/de";

// DS-H-02b: the dictionary key of the plain German text name of every station, gate and prop (ASSETS.md §8:
// no meaning by colour or shape alone). DS-H-04 shows the name as HTML next to the sprite; rasters carry no
// text (§1).
export const NAMES: Readonly<Record<string, MessageKey>> = {
  "station-plan-0": "hall.station.plan",
  "station-build-0": "hall.station.build",
  "station-check-0": "hall.station.check",
  "station-ops-0": "hall.station.ops",
  "gate-hall-0": "hall.gate",
  "prop-tray-0": "hall.prop.tray",
  "prop-stamp-0": "hall.prop.stamp",
};
