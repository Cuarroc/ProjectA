import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

const cls = (...p: (string | false | undefined)[]) => p.filter(Boolean).join(" ");

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
  /** 36px instead of 40px. */
  compact?: boolean;
}

/** Needs an accessible name: a <label>, aria-label or aria-labelledby. Mark errors with aria-invalid. */
export function Input({ mono, compact, className, ...rest }: InputProps) {
  return <input className={cls("g-inp", mono && "g-inp--mono", compact && "g-inp--sm", className)} {...rest} />;
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  mono?: boolean;
}

export function Textarea({ mono, className, ...rest }: TextareaProps) {
  return <textarea className={cls("g-inp", "g-inp--area", mono && "g-inp--mono", className)} {...rest} />;
}
