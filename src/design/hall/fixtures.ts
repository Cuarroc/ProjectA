import type { MessageKey } from "../../i18n/de";
import type { Role } from "./figures/poses";

// DS-H-04 (ASSETS.md §8): fixed synthetic data for the probe hall, never real agents, PRs or people.

export interface HallPiece {
  id: string;
  name: MessageKey;
  role: Role;
  /** The observed state form; missing means not observed and draws as unknown. */
  state?: string;
  /** A valid evidence stamp lies next to the piece. */
  stamped?: boolean;
}

export interface HallScene {
  pieces: readonly HallPiece[];
}

export const SAMPLE_HALL: HallScene = {
  pieces: [
    { id: "probe-a", name: "hall.piece.a", role: "build", state: "run" },
    { id: "probe-b", name: "hall.piece.b", role: "check", state: "ok", stamped: true },
    { id: "probe-c", name: "hall.piece.c", role: "ops" },
  ],
};

export const EMPTY_HALL: HallScene = { pieces: [] };
