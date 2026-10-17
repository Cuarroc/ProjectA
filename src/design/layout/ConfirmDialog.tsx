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

/** Red-first stub (DS-X-08): renders nothing until the real component lands. */
export function ConfirmDialog(_props: ConfirmDialogProps) {
  return null;
}
