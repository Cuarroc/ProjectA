import type { ReactNode } from "react";

export type BannerKind = "info" | "ok" | "warn" | "bad";

// Red stub: the real Banner follows in the next commit.
export function Banner(_: { kind: BannerKind; className?: string; children?: ReactNode }) {
  return null;
}
