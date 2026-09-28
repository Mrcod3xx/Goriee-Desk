"use client";

import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { Icon } from "@/components/desk-icon";

type ErrorBoundaryProps = {
  children: ReactNode;
  /** Short label naming the region, e.g. "Market scanner". Shown in the fallback. */
  label?: string;
  /**
   * Rendered instead of the default card. Use it when a region already has its
   * own empty/error visual language and the default would clash.
   */
  fallback?: (error: Error, recover: () => void) => ReactNode;
  /** Invoked after the boundary catches, so the caller can log or clear state. */
  onError?: (error: Error, info: ErrorInfo) => void;
  /**
   * Value that, when changed, clears a caught error automatically. Useful for
   * regions that reset naturally on navigation, e.g. the active tab.
   */
  resetKey?: unknown;
};

type ErrorBoundaryState = { error: Error & { digest?: string } | null };

/**
 * Panel-level error boundary.
 *
 * The app router's `error.tsx` only protects a whole route segment, so anything
 * that throws inside it replaces the entire desk. This exists to contain a
 * failure to the one panel that broke: a bad render in the order book or the
 * heatmap should degrade to a small recoverable card, not take the research
 * view, the paper account and the chart with it.
 *
 * React has no hook equivalent for this — `getDerivedStateFromError` and
 * `componentDidCatch` only exist on class components — so this stays a class.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error & { digest?: string }): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the failure in the console with its component stack; the boundary is
    // for the user's benefit, not a substitute for the actual trace.
    console.error(`[ErrorBoundary] ${this.props.label ?? "panel"} failed:`, error, info.componentStack);
    this.props.onError?.(error, info);
  }

  componentDidUpdate(previous: ErrorBoundaryProps) {
    // Recover when the caller tells us the context changed (switching tabs),
    // otherwise a stale error would follow the user into the new view.
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private recover = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.recover);

    const label = this.props.label ?? "This panel";

    return (
      <div className="desk-panel-error" role="alert">
        <span className="desk-panel-error-icon" aria-hidden="true">
          <Icon name="alert" size={18} />
        </span>
        <div className="desk-panel-error-body">
          <h3>{label} could not be displayed</h3>
          <p>
            Something went wrong while rendering {label.toLowerCase()}. The rest of
            the desk is still working, and your paper account and saved research
            are untouched.
          </p>
          {error.digest ? <code className="desk-panel-error-code">Reference {error.digest}</code> : null}
          <button type="button" className="desk-panel-error-action" onClick={this.recover}>
            Retry {label.toLowerCase()}
          </button>
        </div>
      </div>
    );
  }
}
