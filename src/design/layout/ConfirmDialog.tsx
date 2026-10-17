import { useEffect, useId, useRef } from "react";
import { de } from "../../i18n/de";
import { Button } from "../controls/Button";
import { Sheet } from "./Sheet";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}

/** Alert dialog for a decision that costs something: Abbrechen comes first and takes focus, Esc cancels, the scrim does not close it, and confirm fires once per opening. */
export function ConfirmDialog({ open, title, description, confirmLabel, cancelLabel = de["confirm.cancel"], tone = "default", onConfirm, onCancel }: ConfirmDialogProps) {
  const id = useId();
  const fired = useRef(false);
  useEffect(() => { if (open) fired.current = false; }, [open]);
  const confirm = () => {
    if (fired.current) return;
    fired.current = true;
    onConfirm();
  };

  return (
    <Sheet open={open} onClose={onCancel} role="alertdialog" size="sm" dismissOnScrim={false} aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`}>
      <div className="g-confirm">
        <h2 id={`${id}-t`}>{title}</h2>
        <p id={`${id}-d`}>{description}</p>
        <div className="g-confirm__actions">
          <Button onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={confirm}>{confirmLabel}</Button>
        </div>
      </div>
    </Sheet>
  );
}
