// Fallback components for ErrorBoundary. Both are stale-chunk aware: when the
// caught error is a deploy-drift import failure (isStaleChunkError), they swap
// the failure text for a refresh prompt — the fix is a reload, and the user
// decides when (deliberately no auto-reload; see src/lib/staleChunk.ts).
import { isStaleChunkError, pageReloader } from "@/lib/staleChunk";

const STALE_MESSAGE = "a new version of the app is available";

export function PanelError({ error, reset }: { error?: Error; reset?: () => void }) {
  const stale = isStaleChunkError(error);
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <p className="text-xs mono" style={{ color: stale ? "var(--tan)" : "var(--error-text)" }}>
        {stale ? STALE_MESSAGE : "failed to load"}
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
  if (isStaleChunkError(error)) {
    return (
      <span className="text-xs mono" role="alert" style={{ color: "var(--tan-3)" }}>
        {STALE_MESSAGE} —{" "}
        <button onClick={() => pageReloader.reload()} className="text-accent hover:underline">refresh</button>
      </span>
    );
  }
  return <span className="text-xs mono" style={{ color: "var(--error-text)" }} role="alert">failed to render</span>;
}
