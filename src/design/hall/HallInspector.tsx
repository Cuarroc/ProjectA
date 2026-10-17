import { de } from "../../i18n/de";
import { StateMark } from "../state/StateMark";
import { ROLE_WORDS } from "./figures/poses";
import type { HallPiece } from "./fixtures";

// DS-H-05: the selected piece, task first (Aufgabe, then Zustand, then Rolle); empty is said in words.

export function HallInspector({ piece }: { piece: HallPiece | undefined }) {
  return (
    <section className="g-hall__inspector" aria-label={de["hall.inspector.title"]} aria-live="polite">
      {piece ? (
        <dl>
          <dt>{de["hall.inspector.task"]}</dt>
          <dd>{de[piece.name]}</dd>
          <dt>{de["hall.inspector.state"]}</dt>
          <dd><StateMark form={piece.state} /></dd>
          <dt>{de["hall.inspector.role"]}</dt>
          <dd>{ROLE_WORDS[piece.role]}</dd>
        </dl>
      ) : (
        <p>{de["hall.inspector.none"]}</p>
      )}
    </section>
  );
}
