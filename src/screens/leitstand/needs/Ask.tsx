import { useState, type KeyboardEvent } from "react";

import { Button } from "../../../design/controls/Button";
import { ErrorDetails } from "../../../errors/ErrorDetails";
import { texts, userError } from "../../../errors/texts";
import { Input } from "../../../design/inputs/Input";
import { fill } from "../leitstand";
import { useT } from "../../../i18n/useT";
import { describeError } from "../../../lib/ipc";
import type { Question, Worker } from "../../../types";

/** The asker's offered answers; a string that will not parse means none. */
function parseOptions(json: string | null): string[] {
  try {
    const value: unknown = JSON.parse(json ?? "[]");
    return Array.isArray(value) ? value.filter((o): o is string => typeof o === "string" && o.trim() !== "") : [];
  } catch {
    return [];
  }
}

function age(createdAt: number, nowMs: number, t: ReturnType<typeof useT>): string {
  const minutes = Math.max(0, Math.floor((nowMs / 1000 - createdAt) / 60));
  if (minutes < 1) return t("needs.justNow");
  return minutes < 60 ? fill(t("needs.minutes"), { n: minutes }) : fill(t("needs.hours"), { n: Math.floor(minutes / 60) });
}

export function Ask({ q, worker, onAnswer }: { q: Question; worker?: Worker; onAnswer: (id: string, text: string) => Promise<void> }) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preflight = q.scope === "preflight";

  const send = async (text: string) => {
    if (busy || text.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      await onAnswer(q.id, text);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      // The card may outlive a successful answer until the next poll.
      setBusy(false);
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") setDraft("");
    else if (e.key === "Enter") {
      e.preventDefault();
      void send(draft);
    }
  };

  return (
    <li className="n-ask">
      <div className="n-from">
        <b>{worker?.branch ?? (preflight ? t("needs.preflight") : t("needs.noAgent"))}</b>
        {worker?.task}
        <span className="n-age">{age(q.createdAt, Date.now(), t)}</span>
      </div>
      <p>{q.question}</p>
      <div className="n-opts">
        {parseOptions(q.optionsJson).map((option, i) => (
          <Button key={`${i}-${option}`} size="sm" disabled={busy} onClick={() => void send(option)}>
            {option}
          </Button>
        ))}
      </div>
      <div className="n-compose">
        <Input
          compact
          name="needs-answer"
          aria-label={t("needs.answerLabel")}
          aria-invalid={error !== null || undefined}
          placeholder={preflight ? t("needs.placeholderPreflight") : t("needs.placeholder")}
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button size="sm" variant="tint" disabled={busy || draft.trim() === ""} onClick={() => void send(draft)}>
          {busy ? t("needs.sending") : t("needs.send")}
        </Button>
      </div>
      {error !== null && (
        <div className="n-error" role="alert">
          <p>{userError(error, texts.actionFailed).text}</p>
          <ErrorDetails raw={userError(error).detail} />
        </div>
      )}
      <p className="n-note">{preflight ? t("needs.keys") : `${t("needs.direct")} ${t("needs.keys")}`}</p>
    </li>
  );
}
