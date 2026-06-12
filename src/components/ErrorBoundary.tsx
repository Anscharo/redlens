import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  onError?: (error: Error, info: ErrorInfo) => void;
  /** Clears the boundary's error state when this value changes — without
   *  remounting the children. Use this for route-change-driven resets so the
   *  child tree's state, memos, and Suspense cache survive navigation. */
  resetKey?: unknown;
}

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.reset();
    }
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      const { fallback } = this.props;
      return typeof fallback === "function"
        ? fallback(this.state.error, this.reset)
        : fallback;
    }
    return this.props.children;
  }
}

export function PanelError({ reset }: { reset?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <p className="text-xs mono" style={{ color: "var(--error-text)" }}>failed to load</p>
      {reset && <button onClick={reset} className="text-xs mono text-accent hover:underline">retry</button>}
    </div>
  );
}

export function InlineError() {
  return <span className="text-xs mono" style={{ color: "var(--error-text)" }} role="alert">failed to render</span>;
}
