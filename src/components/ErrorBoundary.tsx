import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Names the slot this boundary guards, so a crashed view reads as "this
   * view broke" instead of "the whole app died". The app-wide boundary leaves
   * it unset and falls back to a generic line.
   */
  label?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * A render error otherwise takes the whole window to white. One boundary sits
 * around the entire app and each view slot in the main area has its own, so a
 * broken view costs its own surface while the shell around it keeps working.
 * The surface shows what broke and offers the one reliable way out: a reload
 * (the app's state lives in SQLite, only the PTY sessions are lost).
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The surface shows the message; the stack belongs to the console.
    console.error("ErrorBoundary fing einen Render-Fehler:", error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <div className="error-boundary" role="alert">
        <p className="error-boundary-title">
          {this.props.label === undefined
            ? "Die Oberfläche ist abgestürzt."
            : `${this.props.label} ist abgestürzt.`}
        </p>
        <p className="error-boundary-detail">{error.message}</p>
        <button
          type="button"
          className="empty-action"
          onClick={() => window.location.reload()}
        >
          Neu laden
        </button>
      </div>
    );
  }
}
