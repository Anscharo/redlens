const BUTTON = "mono text-xs px-3 py-1.5 rounded border transition-colors hover:bg-[var(--hover)]";

// The card's action row: "View Doc Collection" on the left, Rename/Delete grouped
// on the right. A conversation that cites nothing has no collection to view.
export function ConversationActions({
  citationCount,
  onViewCollection,
  onRename,
  onDelete,
}: {
  citationCount: number;
  onViewCollection: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className={`${BUTTON} disabled:opacity-50 disabled:cursor-default disabled:hover:bg-transparent`}
        style={{ borderColor: "var(--border)", color: "var(--accent)" }}
        disabled={citationCount === 0}
        title={citationCount === 0 ? "No cited documents yet" : "Open the cited documents in the reader"}
        onClick={onViewCollection}
      >
        View Doc Collection
      </button>
      <div className="flex gap-2 ml-auto">
        <button type="button" className={BUTTON} style={{ borderColor: "var(--border)", color: "var(--tan-3)" }} onClick={onRename}>
          Rename
        </button>
        <button type="button" className={BUTTON} style={{ borderColor: "var(--border)", color: "var(--error-text)" }} onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}
