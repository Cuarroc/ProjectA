/**
 * The one live region of the shell (APP-11 / APP-20 of the ui-ux-pro-max audit).
 *
 * Counter badges change on their own (questions arrive, workers ask for
 * attention) and a view switch repaints the whole right half; none of that
 * used to be announced. Instead of turning every badge into a competing
 * live region, one visually hidden status line speaks a complete sentence
 * whenever it changes. React only touches the DOM when the text differs, so
 * an unchanged count is not re-announced.
 */

export interface LiveStatusProps {
  /** Label of the view currently shown. */
  view: string;
  questions: number;
  attention: number;
}

export function statusSentence({ view, questions, attention }: LiveStatusProps): string {
  const parts = [`Ansicht ${view}.`];
  if (questions > 0) parts.push(`${questions} offene ${questions === 1 ? "Frage" : "Fragen"}.`);
  if (attention > 0) {
    parts.push(`${attention} Worker ${attention === 1 ? "wartet" : "warten"} auf dich.`);
  }
  return parts.join(" ");
}

export default function LiveStatus(props: LiveStatusProps) {
  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {statusSentence(props)}
    </div>
  );
}
