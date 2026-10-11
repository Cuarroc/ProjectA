import { Component, type ReactNode } from "react";
export class AppErrorBoundary extends Component<{ children: ReactNode }> {
  override render() { return this.props.children; }
}
