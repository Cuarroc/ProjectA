import { explainError } from "../lib/plainText";

/** An error in plain German; the original text stays one click away. */
export default function ErrorNote({ message }: { message: string }) {
  const { what, todo, raw } = explainError(message);
  return (
    <div className="error-note" role="alert">
      <p>
        <strong>Was ist passiert?</strong> {what}
      </p>
      <p>
        <strong>Was du tun kannst:</strong> {todo}
      </p>
      <details>
        <summary>Originaltext anzeigen</summary>
        <pre className="error-note-raw">{raw}</pre>
      </details>
    </div>
  );
}
