import { usePreviewDiff } from "../../lib/previewDiff";

// Preview redline marker, placed between the doc number and the title so it's
// unambiguous which doc it refers to: "+" = new in this preview, "Δ" = changed.
// Renders nothing outside preview (empty diff). Used in both the reader
// (CollapsibleNode) and the minitree (TreeRow).
export function PreviewMark({ nodeId, className }: { nodeId: string; className?: string }) {
  const diff = usePreviewDiff();
  const added = diff.added.has(nodeId);
  const changed = !added && diff.changed.has(nodeId);
  if (!added && !changed) return null;
  return (
    <span
      className={className}
      title={added ? "New in this preview" : "Changed in this preview"}
      aria-label={added ? "new in this preview" : "changed in this preview"}
      style={{ color: "#fff", fontWeight: 700, flexShrink: 0 }}
    >
      {added ? "+" : "Δ"}
    </span>
  );
}
