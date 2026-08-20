import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureException } from "@/lib/analytics";
import { isStaleChunkError } from "@/lib/staleChunk";

// The stale-chunk-aware fallback components live in ErrorFallbacks.tsx;
// re-exported here so call sites import boundary + fallbacks from one place.
export { PanelError, InlineError } from "./ErrorFallbacks";

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
    // staleChunk tags deploy-drift errors for tracking. Deliberately no
    // auto-reload — the fallback shows a refresh prompt and the user decides.
    const staleChunk = isStaleChunkError(error);
    captureException(error, { mechanism: "ErrorBoundary", componentStack: info.componentStack, staleChunk });
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

