import "../../../design/inputs/inputs.css";
import { Meter } from "../../../design/inputs/Meter";
import { fill } from "../leitstand";
import type { QuotaView } from "./forecast";
import { T } from "./texts";

/** The tighter quota window of one profile as a bar, the forecast sentence, and the failover name only when the view carries it. No percent, no bar: a missing reading is never drawn as zero. Two siblings, so a parent grid can seat the bar beside the lamp row (`.fl-meta`). */
export function QuotaMeter({ view, name }: { view: QuotaView; name: string }) {
  return (
    <>
      {view.percent !== null && <Meter value={view.percent} aria-label={fill(T.meter, { name, percent: view.percent })} />}
      <span className="fl-quota">
        <span>{view.forecast}</span>
        {view.failoverName !== null && <span>{fill(T.failover, { name: view.failoverName })}</span>}
      </span>
    </>
  );
}
