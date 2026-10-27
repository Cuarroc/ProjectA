import { useId } from "react";
import { Button } from "../../design/controls/Button";
import "../../design/controls/controls.css";
import { fileLabel } from "../../lib/diff";
import { classifyDiff, reviewClassInfo } from "../../lib/reviewClass";
import type { DiffFile } from "../../types";
import { fileTexts } from "./files/texts";

interface DiffFileListProps {
  readonly files: readonly DiffFile[];
  readonly selectedPath: string | null;
  readonly commentCounts: ReadonlyMap<string, number>;
  readonly onSelect: (path: string) => void;
}

export function DiffFileList({ files, selectedPath, commentCounts, onSelect }: DiffFileListProps) {
  const descriptionId = useId();
  return (
    <div className="diff-files" role="group" aria-label={fileTexts.group}>
      {files.map((file, index) => {
        const active = selectedPath === file.path;
        const notes = commentCounts.get(file.path) ?? 0;
        const label = fileLabel(file.path, file.oldPath);
        const info = reviewClassInfo(classifyDiff(file.oldPath ? [file.path, file.oldPath] : [file.path]) ?? "unknown");
        return (
          <Button
            key={file.path}
            variant="ghost"
            className={`diff-file${active ? " diff-file-active" : ""}`}
            title={label}
            aria-label={fileTexts.file(label)}
            aria-describedby={`${descriptionId}-${index}`}
            aria-current={active ? "true" : undefined}
            onClick={() => onSelect(file.path)}
          >
            <span className="sr-only" id={`${descriptionId}-${index}`}>
              {fileTexts.counts(file.additions, file.deletions, notes)}
            </span>
            <span className="diff-file-content">
              <span className="diff-file-path">{label}</span>
              <span className="diff-file-counts">
                <span className="diff-file-class" title={fileTexts.review(info.label, info.explanation)}>{info.label}</span>
                <span className="diff-add-count">+{file.additions}</span>
                <span className="diff-del-count">-{file.deletions}</span>
                {file.binary ? <span className="diff-file-binary">{fileTexts.binary}</span> : null}
                {notes > 0 ? <span className="diff-file-notes" title={fileTexts.comments(notes)}>{notes}</span> : null}
              </span>
            </span>
          </Button>
        );
      })}
    </div>
  );
}
