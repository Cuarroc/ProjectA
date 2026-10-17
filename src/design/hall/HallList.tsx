import { de } from "../../i18n/de";
import { StateMark } from "../state/StateMark";
import { Badge } from "../surface/Badge";
import { ListRow } from "../surface/ListRow";
import { ROLE_WORDS } from "./figures/poses";
import type { HallPiece } from "./fixtures";

// DS-H-05: the list projection of the hall's pieces. Its rows are the only tab stops; the scene stays decorative.

export function HallList({ pieces, selected, onToggle }: { pieces: readonly HallPiece[]; selected: string | undefined; onToggle: (id: string) => void }) {
  return (
    <ul className="g-hall__list" aria-label={de["hall.list.label"]}>
      {pieces.map((p) => (
        <li key={p.id}>
          <ListRow data-piece={p.id} current={p.id === selected} onClick={() => onToggle(p.id)}>
            <span className="g-hall__grow">{de[p.name]}</span>
            <StateMark form={p.state} />
            <span className="g-hall__ex">{ROLE_WORDS[p.role]}</span>
            {p.stamped && <Badge tone="accent">{de["hall.prop.stamp"]}</Badge>}
          </ListRow>
        </li>
      ))}
    </ul>
  );
}
