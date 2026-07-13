import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureException } from "../lib/analytics";
import { isStaleChunkError, pageReloader, reloadForStaleChunk } from "../lib/staleChunk";

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
    const staleChunk = isStaleChunkError(error);
    captureException(error, { mechanism: "ErrorBoundary", componentStack: info.componentStack, staleChunk });
    this.props.onError?.(error, info);
    // Deploy drift: the chunk this tab wants was replaced by a newer build, and
    // a refresh is the fix — do it for the user. The fallback UI (rendered
    // regardless) only stays visible if the reload-loop guard blocks.
    if (staleChunk) reloadForStaleChunk();
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

export function PanelError({ error, reset }: { error?: Error; reset?: () => void }) {
  const stale = error !== undefined && isStaleChunkError(error);
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <p className="text-xs mono" style={{ color: stale ? "var(--tan)" : "var(--error-text)" }}>
        {stale ? "a new version of the app is available" : "failed to load"}
      </p>
      {stale ? (
        <button onClick={() => pageReloader.reload()} className="text-xs mono text-accent hover:underline">refresh to update</button>
      ) : (
        reset && <button onClick={reset} className="text-xs mono text-accent hover:underline">retry</button>
      )}
    </div>
  );
}

export function InlineError({ error }: { error?: Error }) {
  if (error !== undefined && isStaleChunkError(error)) {
    return (
      <span className="text-xs mono" role="alert" style={{ color: "var(--tan-3)" }}>
        a new version of the app is available —{" "}
        <button onClick={() => pageReloader.reload()} className="text-accent hover:underline">refresh</button>
      </span>
    );
  }
  return <span className="text-xs mono" style={{ color: "var(--error-text)" }} role="alert">failed to render</span>;
}
