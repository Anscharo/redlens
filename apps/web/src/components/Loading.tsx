// Shared loading indicator for route-level Suspense fallbacks and data
// fetches. Twinkling ✦ in mono/tan-3. Default copy "searching the stars"
// can be overridden with children for contextual messages.
//
// Not used for: the SearchBar input placeholder (visual context differs)
// and NodeContentSkeleton (layout skeleton, different purpose).

import type { ReactNode } from "react";

export function Loading({ children }: { children?: ReactNode }) {
  return (
    <div className="flex-1 flex items-center justify-center py-24">
      <p className="mono text-xs" style={{ color: "var(--tan-3)" }}>
        <span className="loading-twinkle">✦</span>
        {children ?? "searching the stars"}
      </p>
    </div>
  );
}
