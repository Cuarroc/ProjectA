import { useCallback, useMemo, useState, type KeyboardEvent } from "react";

import { describeError } from "../lib/ipc";
import type { QuestionsState } from "../lib/useQuestions";
import type { AnsweredBy, Project, Question, QuestionStatus, Worker } from "../types";

interface QuestionsViewProps {
  questions: QuestionsState;
  /** Every registered project — the fleet view names the ones it brings in. */
  projects: Project[];
  /**
   * The project `workers` belongs to. A question from any other project has no
   * worker to resolve here, which is what the card has to say rather than hide.
   */
  activeProjectId: string | null;
  /** The active project's workers, for putting a branch name on a question. */
  workers: Worker[];
  /** Opens the worker that is waiting — the same jump a board card makes. */
  onOpenWorker: (worker: Worker) => void;
}

const STATUS_LABELS: Record<QuestionStatus, string> = {
  open: "offen",
  answered: "beantwortet",
  expired: "abgelaufen",
  refused: "abgewiesen",
};

/**
 * A question's state in the colours the board already uses for its columns:
 * waiting is attention yellow, a decision made is the green of something
 * finished, and the two the app closed by itself stay out of the way.
 */
function statusStateClass(status: QuestionStatus): string {
  switch (status) {
    case "open":
      return "state-needs-you";
    case "answered":
      return "state-ready-to-merge";
    case "refused":
      return "state-danger";
    default:
      return "state-done";
  }
}

interface Attribution {
  label: string;
  title: string;
  className: string;
}

/**
 * Who decided, read off `answeredBy` and nothing else.
 *
 * The core built this field precisely so the view would not have to weigh
 * `status` against an answer text to find out. "Answered" and "answered by a
 * person" are different claims, and only the window can produce the second
 * one, so the third case says plainly that nobody did.
 */
function attribution(answeredBy: AnsweredBy | null): Attribution {
  switch (answeredBy) {
    case "human":
      return {
        label: "von einem Menschen beantwortet",
        title:
          "Über dieses Fenster beantwortet. Ein Tauri-Command ist von außen nicht erreichbar, " +
          "also ist das der einzige Weg, den kein Agent nehmen kann.",
        className: "question-by-human",
      };
    case "unverified":
      return {
        label: "beantwortet, Herkunft ungeprüft",
        title:
          "Über die API oder `pa answer` beantwortet, ohne Verdict-Token. Das kann ein Mensch " +
          "am Terminal gewesen sein oder der fragende Agent selbst — von hier aus sieht beides " +
          "gleich aus.",
        className: "question-by-unverified",
      };
    default:
      return {
        label: "niemand hat entschieden",
        title:
          "Kein Aufrufer hat geantwortet. Die Zeile wurde von der Uhr oder von der " +
          "Budget-Regel geschlossen; der Status daneben sagt, von welcher der beiden.",
        className: "question-by-nobody",
      };
  }
}

/**
 * The answers the asker offered, or none at all.
 *
 * The core stores this as the text it was given and never reads it, so a
 * string that will not parse means "no options offered" — not a broken
 * question. A question is always answerable by typing.
 */
function parseOptions(optionsJson: string | null): string[] {
  if (optionsJson === null) return [];
  try {
    const parsed: unknown = JSON.parse(optionsJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is string => typeof entry === "string" && entry.trim() !== "",
    );
  } catch {
    return [];
  }
}

/** How long a question has been waiting, in the coarsest unit that still says it. */
function formatAge(createdAt: number, now: number): string {
  const seconds = Math.max(0, now - createdAt);
  if (seconds < 60) return "gerade eben";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `seit ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `seit ${hours} h ${minutes % 60} min`;
  return `seit ${Math.floor(hours / 24)} d`;
}

/**
 * How much of the four hours is left. Deliberately not a countdown to the
 * second: the number that matters is whether this is a decision for now or one
 * for later.
 */
function formatDeadline(expiresAt: number | null, now: number): string | null {
  if (expiresAt === null) return null;
  const seconds = expiresAt - now;
  if (seconds <= 0) return "Frist abgelaufen, die Uhr antwortet gleich";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `noch ${Math.max(1, minutes)} min`;
  return `noch ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Short local timestamp for a row that is already closed. */
function formatStamp(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return "";
  const at = new Date(seconds * 1000);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleString(undefined, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A question's project, as the fleet-wide list has to name it. */
interface ProjectRef {
  /** The project whose workers are loaded here — the only jumps that resolve. */
  active: boolean;
  label: string;
  title: string;
}

/**
 * What stands where the branch would, when there is nothing to jump to.
 *
 * Three different reasons, and the third must not be read as the second: only
 * the active project's workers are loaded in this window, so a question from
 * anywhere else has no branch to show. That is a limit of this list, not a
 * worker that disappeared — and answering it works either way.
 */
function workerNote(
  question: Question,
  project: ProjectRef | null,
): { label: string; title: string } {
  if (question.scope === "preflight") {
    return {
      label: "Preflight — noch kein Worker",
      title: "Diese Frage wurde gestellt, bevor es einen Worker gab.",
    };
  }
  if (project !== null && !project.active) {
    return {
      label: `Worker in ${project.label}`,
      title:
        "Nur die Worker des aktiven Projekts sind hier geladen, also führt von dieser Karte " +
        "kein Weg ins Terminal. Zum Öffnen erst auf das Projekt wechseln — antworten geht " +
        "von hier aus trotzdem.",
    };
  }
  return {
    label: "Worker nicht mehr da",
    title: "Der Worker dieser Frage existiert nicht mehr.",
  };
}

/**
 * One decision that is still waiting, with everything needed to make it: who
 * is blocked, how long they have been, the question in full, and the answer
 * going straight back into their terminal.
 *
 * Exported because the preflight dialogue reuses it (Phase 21 P1). The new
 * worker dialog is a modal, so a person waiting on its questions cannot reach
 * this tab to answer them; it renders the same card over the same rows
 * instead, rather than growing a second way to answer a question.
 */
export function OpenQuestion({
  question,
  worker,
  project,
  now,
  onOpenWorker,
  onAnswer,
}: {
  question: Question;
  worker: Worker | null;
  /** Which project this belongs to, or `null` when the list is one project. */
  project: ProjectRef | null;
  now: number;
  onOpenWorker: (worker: Worker) => void;
  onAnswer: (id: string, text: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(() => parseOptions(question.optionsJson), [question.optionsJson]);
  const deadline = formatDeadline(question.expiresAt, now);
  const note = workerNote(question, project);

  const send = useCallback(
    async (text: string) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await onAnswer(question.id, text);
      } catch (cause) {
        setError(describeError(cause));
      } finally {
        setBusy(false);
      }
    },
    [busy, onAnswer, question.id],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      if (draft.trim() === "") return;
      void send(draft);
    },
    [draft, send],
  );

  return (
    <article className="question-card state-needs-you">
      <div className="question-meta">
        {project !== null ? (
          <span className="question-owner" title={project.title}>
            {project.label}
          </span>
        ) : null}
        {worker !== null ? (
          <button
            type="button"
            className="question-worker"
            onClick={() => onOpenWorker(worker)}
            title={`${worker.branch} — ${worker.task}`}
          >
            {worker.branch}
          </button>
        ) : (
          <span className="question-worker question-worker-gone" title={note.title}>
            {note.label}
          </span>
        )}
        <span className="question-age">{formatAge(question.createdAt, now)}</span>
        {deadline !== null ? (
          <span
            className="question-deadline"
            title="Nach vier Stunden antwortet die Uhr mit „abgelaufen — entscheide selbst“."
          >
            {deadline}
          </span>
        ) : null}
      </div>
      <p className="question-text">{question.question}</p>
      {options.length > 0 ? (
        <div className="question-options">
          {options.map((option, index) => (
            <button
              // Two identical options are the asker's business, not a reason
              // for React to drop one of the buttons.
              key={`${index}-${option}`}
              type="button"
              className="question-option"
              disabled={busy}
              onClick={() => void send(option)}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
      <div className="question-compose">
        <textarea
          className="question-input"
          aria-label="Antwort"
          rows={2}
          value={draft}
          placeholder={
            options.length > 0
              ? "… oder etwas anderes antworten"
              : question.scope === "preflight"
                ? // No terminal exists yet; whoever asked reads the answer back
                  // off the row. See `deliver()` in questions.rs.
                  "Antwort — sie geht an die Prompt-Schärfung zurück"
                : "Antwort — sie landet direkt im Terminal des Workers"
          }
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className="question-send"
          disabled={busy || draft.trim() === ""}
          onClick={() => void send(draft)}
        >
          {busy ? "Sendet …" : "Antworten"}
        </button>
      </div>
      {error !== null ? <p className="question-error">{error}</p> : null}
      <p className="question-hint">Enter antwortet · Shift+Enter neue Zeile</p>
    </article>
  );
}

/** One decision already made, or one the app made when nobody did. */
function ClosedQuestion({
  question,
  worker,
  project,
}: {
  question: Question;
  worker: Worker | null;
  project: ProjectRef | null;
}) {
  const who = attribution(question.answeredBy);
  const stamp = formatStamp(question.answeredAt ?? question.createdAt);

  return (
    <article className={`question-closed ${statusStateClass(question.status)}`}>
      <div className="question-meta">
        <span className="state-chip">{STATUS_LABELS[question.status]}</span>
        <span className={`question-by ${who.className}`} title={who.title}>
          {who.label}
        </span>
        {project !== null ? (
          <span className="question-owner" title={project.title}>
            {project.label}
          </span>
        ) : null}
        <span className="question-worker question-worker-gone">
          {worker !== null
            ? worker.branch
            : question.scope === "preflight"
              ? "Preflight"
              : // The worker is archived, gone, or simply in another project;
                // its id is all that is left of it here either way.
                (question.workerId ?? "—").slice(0, 8)}
        </span>
        <span className="question-age">{stamp}</span>
      </div>
      <p className="question-text">{question.question}</p>
      <p className="question-answer">{question.answer ?? "—"}</p>
    </article>
  );
}

/**
 * Blocking decisions: the ones waiting on a person, and the record of the ones
 * already made.
 *
 * The switch in the head is the whole point of this view existing twice over.
 * Scoped to the active project it reads like every other view here; scoped to
 * the fleet it catches the case the narrow reading loses — a worker blocked in
 * a project nobody has selected, waiting out its four hours unseen and then
 * answered by the clock. The scope lives in the hook, not here, so the segment
 * badge and the rail counter say the same number this list shows; that one
 * number in three places is why the view was built narrow to begin with.
 */
export default function QuestionsView({
  questions,
  projects,
  activeProjectId,
  workers,
  onOpenWorker,
}: QuestionsViewProps) {
  const [historyOpen, setHistoryOpen] = useState(false);

  const byId = useMemo(() => {
    const map = new Map<string, Worker>();
    for (const worker of workers) map.set(worker.id, worker);
    return map;
  }, [workers]);

  const projectNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects) map.set(project.id, project.name);
    return map;
  }, [projects]);

  // Recomputed on every render, and the 5 s poll is what causes them: the ages
  // move with the list rather than on a clock of their own.
  const now = Math.floor(Date.now() / 1000);

  const { open, history, loading, error, scope, setScope, answer } = questions;
  const fleet = scope === "all";
  const activeName = activeProjectId === null ? null : (projectNames.get(activeProjectId) ?? null);

  /**
   * One project's list names its project once, in the head; the fleet list has
   * to name it on every card, because two cards next to each other can be
   * about two different repositories.
   */
  const projectRef = (question: Question): ProjectRef | null => {
    if (!fleet) return null;
    const name = projectNames.get(question.projectId) ?? null;
    return {
      active: question.projectId === activeProjectId,
      // A question outlives the registration of its project, and it is still a
      // decision someone is waiting on.
      label: name ?? `Projekt ${question.projectId.slice(0, 8) || "?"}`,
      title: name ?? "Dieses Projekt ist nicht mehr registriert.",
    };
  };

  return (
    <div className="questions-view">
      <div className="questions-head">
        <h2 className="section-title">Fragen</h2>
        {open.length > 0 ? (
          <span className="state-chip state-needs-you">{open.length}</span>
        ) : null}
        <div className="segmented questions-scope" role="group" aria-label="Umfang">
          <button
            type="button"
            className={`segment${fleet ? "" : " segment-active"}`}
            aria-pressed={!fleet}
            title="Nur die Entscheidungen des aktiven Projekts"
            onClick={() => setScope("project")}
          >
            Nur dieses Projekt
          </button>
          <button
            type="button"
            className={`segment${fleet ? " segment-active" : ""}`}
            aria-pressed={fleet}
            title={
              "Alle Projekte — ein blockierter Worker in einem inaktiven Projekt wäre sonst " +
              "unsichtbar, bis die Uhr nach vier Stunden für ihn antwortet"
            }
            onClick={() => setScope("all")}
          >
            Alle Projekte
          </button>
        </div>
        <span className="questions-project">
          {fleet ? "Alle Projekte" : (activeName ?? "Kein Projekt")}
        </span>
      </div>
      <div className="questions-body">
        {error !== null ? <p className="questions-note questions-note-error">{error}</p> : null}
        {!fleet && activeProjectId === null ? (
          <p className="questions-note">
            Kein Projekt aktiv. <em>Alle Projekte</em> zeigt trotzdem, worauf gerade jemand
            wartet.
          </p>
        ) : loading && open.length === 0 && history.length === 0 ? (
          <p className="questions-note">Lädt …</p>
        ) : open.length === 0 ? (
          <p className="questions-note">
            Keine offene Entscheidung{fleet ? " in irgendeinem Projekt" : ""}. Ein Agent stellt
            eine Frage mit <code>pa ask</code>, wenn er ohne sie nicht weiterkommt; sein Worker
            geht dabei auf <em>braucht dich</em>.
          </p>
        ) : (
          <div className="questions-list">
            {open.map((question) => (
              <OpenQuestion
                key={question.id}
                question={question}
                worker={byId.get(question.workerId ?? "") ?? null}
                project={projectRef(question)}
                now={now}
                onOpenWorker={onOpenWorker}
                onAnswer={answer}
              />
            ))}
          </div>
        )}
        {history.length > 0 ? (
          <section className="questions-history">
            <button
              type="button"
              className="questions-history-toggle"
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen((current) => !current)}
            >
              {historyOpen ? "▾" : "▸"} Entschieden · {history.length}
            </button>
            {historyOpen ? (
              <div className="questions-list">
                {history.map((question) => (
                  <ClosedQuestion
                    key={question.id}
                    question={question}
                    worker={byId.get(question.workerId ?? "") ?? null}
                    project={projectRef(question)}
                  />
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
