import type { ComponentProps } from "react";

const BUTTON = "mono text-xs px-3 py-1.5 rounded border transition-colors hover:bg-[var(--hover)]";

function ActionButton({ color, className, ...props }: ComponentProps<"button"> & { color: string }) {
  return <button type="button" {...props} className={className ? `${BUTTON} ${className}` : BUTTON} style={{ borderColor: "var(--border)", color }} />;
}

// The card's action row: "View Doc Collection" on the left, Rename/Delete grouped
// on the right. A conversation that cites nothing has no collection to view.
interface ConversationActionsProps {
  citationCount: number;
  onViewCollection: () => void;
  onRename: () => void;
  onDelete: () => void;
}

export function ConversationActions({ citationCount, onViewCollection, onRename, onDelete }: ConversationActionsProps) {
  const none = citationCount === 0;
  return (
    <div className="flex items-center gap-2">
      <ActionButton
        color="var(--accent)"
        className="disabled:opacity-50 disabled:cursor-default disabled:hover:bg-transparent"
        disabled={none}
        title={none ? "No cited documents yet" : "Open the cited documents in the reader"}
        onClick={onViewCollection}
      >
        View Doc Collection
      </ActionButton>
      <div className="flex gap-2 ml-auto">
        <ActionButton color="var(--tan-3)" onClick={onRename}>
          Rename
        </ActionButton>
        <ActionButton color="var(--error-text)" onClick={onDelete}>
          Delete
        </ActionButton>
      </div>
    </div>
  );
}
