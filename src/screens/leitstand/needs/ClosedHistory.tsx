import { useT } from "../../../i18n/useT";
import type { Question } from "../../../types";
import { fill } from "../leitstand";
import { HISTORY_TEXT as text } from "./history/texts";

/** Stored IDs remain meaningful even after projects or workers disappear. */
export function ClosedHistory({ history }: { history: Question[] }) {
  const t = useT();
  if (history.length === 0) return null;
  return (
    <ul className="n-list" aria-label={t("tab.history")}>
      {history.map((q) => {
        const answer = q.answer?.trim() ? q.answer : text.missingAnswer;
        const who = q.answeredBy === null
          ? (q.status === "answered" ? text.unknownOrigin : text.nobody)
          : text[q.answeredBy];
        const stamp = new Date((q.answeredAt ?? q.createdAt) * 1000);
        return (
          <li key={q.id} className="n-ask">
            <p>{q.question}</p>
            <p>{q.status === "answered"
              ? fill(t("needs.answered"), { text: answer })
              : fill(q.status === "expired" ? text.expired : text.refused, { text: answer })}</p>
            <p className="n-note">{who}</p>
            <p className="n-note">{text.project}: {q.projectId || t("state.unknown")}</p>
            <p className="n-note">{q.scope === "preflight"
              ? t("needs.preflight")
              : fill(text.worker, { id: q.workerId || t("state.unknown") })}</p>
            <p className="n-note">
              {q.answeredAt === null ? text.created : text.closed}: {" "}
              <time dateTime={stamp.toISOString()}>{stamp.toLocaleString("de-DE")}</time>
            </p>
          </li>
        );
      })}
    </ul>
  );
}
