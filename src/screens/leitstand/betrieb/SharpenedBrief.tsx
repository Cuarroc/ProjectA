import { useState } from "react";
import type { QueueEntry } from "../../../types";
import { T } from "./texts";

/** Native disclosure: reading a brief never changes its queue state. */
export function SharpenedBrief({ entry }: { entry: QueueEntry }) {
  const [open, setOpen] = useState(false);
  const same = entry.sharpenedText === entry.rawText;
  return (
    <details className="bt-brief" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{T.briefShow}</summary>
      {open && <div className="bt-brief-body">
        <h3>{T.briefOriginal}</h3>
        <p className="bt-brief-text">{entry.rawText}</p>
        {entry.sharpenedText === null ? (
          <p className="bt-note">{entry.status === "sharpening" ? T.briefPreparing : T.briefMissing}</p>
        ) : same ? (
          <p className="bt-note">{T.briefSame}</p>
        ) : <>
          <h3>{T.briefSharpened}</h3>
          <p className="bt-brief-text">{entry.sharpenedText}</p>
        </>}
      </div>}
    </details>
  );
}
