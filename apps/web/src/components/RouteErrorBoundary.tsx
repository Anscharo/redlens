import type { ReactNode } from "react";
import { useLocation } from "wouter";
import { ErrorBoundary, PanelError } from "./ErrorBoundary";
import { isStaleChunkError } from "../lib/staleChunk";

function PageLoadError({ error }: { error: Error }) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 py-24 gap-4">
      <p className="text-sm mono" style={{ color: "var(--error-text)" }}>page failed to load</p>
      <p className="text-xs mono text-tan-3 text-center max-w-md">{error.message}</p>
    </div>
  );
}

/** The page outlet's boundary. Navigating clears the error without remounting
 *  the page, and a stale-chunk failure gets PanelError's refresh prompt. */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return (
    <ErrorBoundary
      resetKey={location}
      fallback={(error) => (isStaleChunkError(error) ? <PanelError error={error} /> : <PageLoadError error={error} />)}
    >
      {children}
    </ErrorBoundary>
  );
}
