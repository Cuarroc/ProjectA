import { Component, type ReactNode } from "react";
import { reportFrontendError } from "./reportFrontendError";

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch(error: Error) { reportFrontendError(error); }
  override render() { return this.state.failed ? null : this.props.children; }
}
