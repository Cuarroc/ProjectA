/**
 * One quiet hint line, shared by queue entries and board cards. `null`,
 * `undefined` and blank text all hide the line, so a caller never wraps it in
 * its own emptiness check — and a "no hint" state can never render as a
 * ghost badge.
 */
export default function InfoLine({
  text,
  tone = "note",
  className,
}: {
  text: string | null | undefined;
  tone?: "note" | "error";
  className?: string;
}) {
  if (text === null || text === undefined || text.trim() === "") return null;
  const classes = [
    "info-line",
    tone === "error" ? "info-line-error" : "",
    className ?? "",
  ]
    .filter((part) => part !== "")
    .join(" ");
  return (
    <p className={classes} title={text}>
      {text}
    </p>
  );
}
