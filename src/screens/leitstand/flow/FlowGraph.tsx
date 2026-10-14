import type { ReactNode } from "react";

import type { FlowLayout, FlowNode } from "./layout";

export interface FlowLabel {
  task: string;
  branch: string;
}

export interface FlowGraphProps {
  layout: FlowLayout;
  labels: Record<string, FlowLabel>;
  renderNode?: (node: FlowNode, label: FlowLabel) => ReactNode;
}

export function FlowGraph(_props: FlowGraphProps) {
  return null;
}
