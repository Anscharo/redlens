import { useEffect, useState } from "react";

const DEFAULT_PAGE_SIZE = 100;

// Caps how many rows of a (possibly large) filtered list are mounted at once,
// so switching filters doesn't force React to unmount/remount thousands of
// DOM nodes in a single commit. Resets to one page whenever `rows` changes
// identity (a new filter result) — callers must memoize `rows` so unrelated
// re-renders (e.g. expanding a row) don't reset the page.
export function usePagedRows<T>(rows: readonly T[], pageSize = DEFAULT_PAGE_SIZE) {
  const [count, setCount] = useState(pageSize);
  useEffect(() => setCount(pageSize), [rows, pageSize]);
  return {
    visible: rows.slice(0, count),
    remaining: Math.max(0, rows.length - count),
    showMore: () => setCount((c) => Math.min(rows.length, c + pageSize)),
  };
}
