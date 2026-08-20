import { useMemo } from "react";
import { useDataSource } from "./dataSource";
import { usePreviewDiff } from "./previewDiff";
import { usePreviewView } from "./previewView";

// In preview mode, true for docs the branch did NOT touch — so the reader/tree
// can very slightly dim them, making the changed/added docs (full strength)
// subtly stand out even in "All" view. No-op outside preview.
export function usePreviewDim(nodeId: string): boolean {
  const { preview } = useDataSource();
  const diff = usePreviewDiff();
  return !!preview && !diff.added.has(nodeId) && !diff.changed.has(nodeId);
}

// The set of doc ids to show when "show only changed" is on: exactly the docs
// this preview adds/changes — no ancestors. The sidebar and reader render these
// as a flat list (each keeps its full doc-number for context). Returns null when
// filtering is off (preview off or toggle off) — meaning "show everything".
export function usePreviewChangedSet(): Set<string> | null {
  const { preview } = useDataSource();
  const { onlyChanged } = usePreviewView();
  const diff = usePreviewDiff();
  return useMemo(() => {
    if (!preview || !onlyChanged) return null;
    return new Set<string>([...diff.added, ...diff.changed]);
  }, [preview, onlyChanged, diff]);
}
