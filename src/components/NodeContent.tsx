import { memo, lazy, Suspense } from "react";
import { ErrorBoundary, InlineError } from "./ErrorBoundary";

const NodeContentInner = lazy(() => import("./NodeContentInner"));

import type { ReportQuery } from "../lib/reportFilter";

interface Props {
  content: string;
  onNavigate?: (id: string) => void;
  /** Report-search query whose matches get <mark>ed in the rendered output. */
  highlight?: ReportQuery;
  /** Skip the KaTeX/`$…$` math path entirely, so dollar amounts and stray
   *  single-symbol spans (`$100k`, `parameter $a$`) render as literal text.
   *  Use for free-form, non-atlas-authored prose (e.g. LLM assessment
   *  reasoning) that was never written with math delimiters in mind. */
  noMath?: boolean;
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
    <ErrorBoundary fallback={(error) => <InlineError error={error} />}>
      <Suspense fallback={<NodeContentSkeleton />}>
        <NodeContentInner {...props} />
      </Suspense>
    </ErrorBoundary>
  );
});
