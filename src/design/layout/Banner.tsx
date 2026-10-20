import type { ReactNode } from "react";

import { de } from "../../i18n/de";
import "./layout.css";

export type BannerKind = "info" | "ok" | "warn" | "bad";

export interface BannerProps {
  kind: BannerKind;
  className?: string;
  children?: ReactNode;
}

/** Inline message in the page flow. bad is an alert (read out at once), the rest are polite status; the kind is named in words, never colour alone. */
export function Banner({ kind, className, children }: BannerProps) {
  return (
    <div className={`g-banner g-banner--${kind}${className ? ` ${className}` : ""}`} role={kind === "bad" ? "alert" : "status"}>
      <strong className="g-banner__word">{de[`banner.${kind}`]}</strong>
      <span className="g-banner__body">{children}</span>
    </div>
  );
}
