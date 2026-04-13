import { memo, lazy, Suspense } from "react";

const NodeContentInner = lazy(() => import("./NodeContentInner"));

interface Props {
  content: string;
  onNavigate?: (id: string) => void;
}

/** Call once after initial render to warm the chunk before the user needs it. */
export function prefetchNodeContent(): void {
  import("./NodeContentInner");
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
    <Suspense fallback={<NodeContentSkeleton />}>
      <NodeContentInner {...props} />
    </Suspense>
  );
});
