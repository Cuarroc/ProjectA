import type { ReactNode } from "react";

// Red stub: the real Tooltip follows in the next commit.
export function Tooltip({ children }: { content: string; children: (props: Record<string, never>) => ReactNode }) {
  return <>{children({})}</>;
}
