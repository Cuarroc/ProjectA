import type { CSSProperties } from "react";

import { de } from "../../i18n/de";
import { StateMark } from "../state/StateMark";
import { STATE_UNKNOWN_FORM, type StateForm } from "../state/states";
import { poseFor, ROLE_WORDS, ROLES, type Role } from "./figures/poses";
import type { HallScene } from "./fixtures";
import figureMap from "./sprites/hall-figures.json";
import tileMap from "./sprites/hall-tiles.json";
import { FLOOR, TILE } from "./tiles/layout";
import { NAMES } from "./tiles/names";
import { usePixelScale } from "./usePixelScale";
import "./hall.css";

// DS-H-04 (ASSETS.md §1, §6, §8): the static probe hall on synthetic data. Sprites are decorative; every
// meaning is also HTML text below the scene. Positions are whole tiles, sizes whole art pixels.

type Frame = readonly number[];
const ATLASES = { tiles: tileMap, figures: figureMap } as Record<"tiles" | "figures", Record<string, Frame>>;
const extent = (map: Record<string, Frame>, i: 0 | 1) => Math.max(...Object.values(map).map((f) => f[i] + f[i + 2]));

/** Station of each role at (column, row 2); its figure stands right of it, the piece below it on the belt. */
const STATION_COL: Record<Role, number> = { plan: 0, build: 3, check: 6, ops: 9 };
const GATE = [3, 1];
const T = 16;

function Sprite({ sheet, id, col, row }: { sheet: keyof typeof ATLASES; id: string; col: number; row: number }) {
  const map = ATLASES[sheet];
  const [x, y, w, h] = map[id];
  return (
    <span
      className={`g-hall__sprite g-hall__sprite--${sheet}`}
      data-sprite={id}
      // Numbers only; hall.css turns art pixels into CSS pixels with --s.
      style={{ "--l": col * T, "--t": row * T, "--w": w, "--h": h, "--x": x, "--y": y, "--aw": extent(map, 0), "--ah": extent(map, 1) } as CSSProperties}
    />
  );
}

/** `scene` undefined: nothing read yet. A piece without a state is unknown; a role without a piece is `ready`. */
export function Hall({ scene }: { scene: HallScene | undefined }) {
  const s = usePixelScale().css;
  const pieces = scene?.pieces ?? [];
  const pieceOf = (role: Role) => pieces.find((p) => p.role === role);
  return (
    <section className="g-hall" aria-label={de["hall.title"]} style={{ "--s": s } as CSSProperties}>
      <p className="g-hall__sample">{de["hall.sample"]}</p>
      <div className="g-hall__scene" aria-hidden="true" style={{ "--cols": FLOOR[0].length, "--rows": FLOOR.length } as CSSProperties}>
        {FLOOR.flatMap((line, row) => [...line].map((c, col) => <Sprite key={`${col}-${row}`} sheet="tiles" id={TILE[c]} col={col} row={row} />))}
        <Sprite sheet="tiles" id="gate-hall-0" col={GATE[0]} row={GATE[1]} />
        {ROLES.map((role) => {
          const c = STATION_COL[role];
          const piece = pieceOf(role);
          // R1646-K1: poseFor(null) means "no run observed"; a piece with a missing state must stay unknown.
          const pose = poseFor(piece ? piece.state ?? STATE_UNKNOWN_FORM : null);
          return [
            <Sprite key={role} sheet="tiles" id={`station-${role}-0`} col={c} row={2} />,
            scene && <Sprite key={`f-${role}`} sheet="figures" id={`fig-${role}-${pose}-0`} col={c + 1} row={1} />,
            piece && <Sprite key={piece.id} sheet="tiles" id="piece-crate-0" col={c + 1} row={3} />,
            piece?.stamped && <Sprite key="stamp" sheet="tiles" id="prop-stamp-0" col={c + 2} row={3} />,
          ];
        })}
      </div>
      <ul className="g-hall__legend">
        {ROLES.map((role) => {
          const piece = pieceOf(role);
          return (
            <li key={role}>
              <span>{de[NAMES[`station-${role}-0`]]} <span className="g-hall__ex">{de["hall.example"]}</span></span>
              <span>{ROLE_WORDS[role]}</span>
              {piece && <span>{de[piece.name]}</span>}
              {piece && <StateMark form={piece.state as StateForm | undefined} />}
              {piece?.stamped && <span>{de[NAMES["prop-stamp-0"]]}</span>}
            </li>
          );
        })}
      </ul>
      <p className="g-hall__note"><span>{de[NAMES["gate-hall-0"]]}</span> <span className="g-hall__ex">{de["hall.example"]}</span></p>
      {!scene && <p className="g-hall__note">{de["hall.unread"]}</p>}
      {scene && pieces.length === 0 && <p className="g-hall__note">{de["hall.empty"]}</p>}
    </section>
  );
}
