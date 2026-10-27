import type { KeyboardEventHandler, ReactNode } from "react";
import type { DiffFile, DiffLine } from "../../types";
import { lineTexts } from "./lines/texts";

interface DiffLinesProps {
  readonly selected: DiffFile | null;
  readonly onKeyDown: KeyboardEventHandler<HTMLDivElement>;
  readonly renderLine: (file: string, line: DiffLine, index: number) => ReactNode;
}

export function DiffLines({ selected, onKeyDown, renderLine }: DiffLinesProps) {
  return (
    <div className="diff-pane" role="region" aria-label={lineTexts.region} onKeyDown={onKeyDown}>
      {selected === null || selected.hunks.length === 0 ? (
        <p className="diff-pane-empty">{selected?.binary ? lineTexts.binary : lineTexts.empty}</p>
      ) : (
        selected.hunks.map((hunk, hunkIndex) => (
          <div key={`${hunkIndex}-${hunk.header}`} className="diff-hunk">
            <div className="diff-hunk-header">{hunk.header}</div>
            {hunk.lines.map((line, index) => renderLine(selected.path, line, index))}
          </div>
        ))
      )}
    </div>
  );
}

const SIGN: Record<DiffLine["kind"], string> = { add: "+", del: "-", context: " " };

export function DiffLineContent({ line, commentCount }: {
  readonly line: DiffLine;
  readonly commentCount: number;
}) {
  return (
    <>
      <span className="diff-gutter">{line.oldLine ?? ""}</span>
      <span className="diff-gutter">{line.newLine ?? ""}</span>
      <span className="diff-marker">
        {commentCount > 0 ? <span className="diff-line-note" title={lineTexts.comments(commentCount)} /> : null}
      </span>
      <span className="diff-sign">{SIGN[line.kind]}</span>
      <span className="diff-text">{line.content}</span>
    </>
  );
}
