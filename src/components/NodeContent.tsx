import { memo, lazy, Suspense } from "react";
import { ErrorBoundary, InlineError } from "./ErrorBoundary";

const NodeContentInner = lazy(() => import("./NodeContentInner"));

interface Props {
  content: string;
  onNavigate?: (id: string) => void;
  math?: boolean;
}

/** Warm the markdown-renderer chunk (the CODE, distinct from the worker's doc
 *  DATA) before the user opens a node. Deferred to idle so it never competes with
 *  the critical first-load fetches (entry JS, search index, atlas tree). */
export function prefetchNodeContent(): void {
  const warm = () => void import("./NodeContentInner");
  if (typeof requestIdleCallback === "function") requestIdleCallback(warm, { timeout: 3000 });
  else setTimeout(warm, 1500);
}

function NodeContentSkeleton() {
  return (
    <div className="animate-pulse space-y-2 py-1">
      <div className="h-3 rounded" style={{ background: "var(--surface)", width: "92%" }} />
      <div className="h-3 rounded" style={{ background: "var(--surface)", width: "78%" }} />
      <div className="h-3 rounded" style={{ background: "var(--surface)", width: "85%" }} />
      <div className="h-3 rounded mt-4" style={{ background: "var(--surface)", width: "60%" }} />
      <div className="h-3 rounded" style={{ background: "var(--surface)", width: "88%" }} />
      <div className="h-3 rounded" style={{ background: "var(--surface)", width: "45%" }} />
    </div>
  );
}

export const NodeContent = memo(function NodeContent(props: Props) {
  return (
    <ErrorBoundary fallback={<InlineError />}>
      <Suspense fallback={<NodeContentSkeleton />}>
        <NodeContentInner {...props} />
      </Suspense>
    </ErrorBoundary>
  );
});
