import { Component, type ReactNode } from "react";
import { texts } from "./texts";
import { reportFrontendError } from "./reportFrontendError";

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch(error: Error) { reportFrontendError(error); }
  override render() { return this.state.failed ? <div role="alert">{texts.failed} <button onClick={() => location.reload()}>{texts.reload}</button></div> : this.props.children; }
}
