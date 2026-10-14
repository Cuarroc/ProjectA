import { texts } from "./texts";

/** The raw backend text behind a translated error, folded away by default. */
export function ErrorDetails({ raw }: { raw: string | null }) {
  if (raw === null) return null;
  return (
    <details className="g-err-details">
      <summary>{texts.details}</summary>
      <code>{raw}</code>
    </details>
  );
}
