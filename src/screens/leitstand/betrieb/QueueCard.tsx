import "../../../design/controls/controls.css";
import { Chip } from "../../../design/controls/Chip";
import { StateMark } from "../../../design/state/StateMark";
import type { StateForm } from "../../../design/state/states";
import { useDiffSummary } from "../../../lib/diff";
import { shortTask } from "../../../lib/text";
import type { QueueEntry } from "../../../types";
import { sizeChip } from "../tickets/sizeChip";
import { SharpenedBrief } from "./SharpenedBrief";

export interface QueueCardProps {
  entry: QueueEntry;
  status: { form: StateForm; label?: string };
  profile: string;
}

/**
 * One queue row as a card. Only a row with a worker has a diff to count; the size is
 * read once per worker (summary cache), not refreshed while the worker keeps writing.
 */
export function QueueCard({ entry, status, profile }: QueueCardProps) {
  const { summary } = useDiffSummary(entry.workerId ?? "", entry.workerId !== null);
  return (
    <li className="g-glass bt-row bt-qcard">
      <StateMark form={status.form} label={status.label} />
      <span className="bt-task" title={entry.rawText}>{shortTask(entry.rawText, 80)}</span>
      <span className="bt-profile">{profile}</span>
      <Chip size="sm">{sizeChip(summary && [summary]).text}</Chip>
      {entry.error?.trim() ? <p className="bt-reason">{entry.error}</p> : null}
      <SharpenedBrief entry={entry} />
    </li>
  );
}
