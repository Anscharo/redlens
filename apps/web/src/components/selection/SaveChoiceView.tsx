import type { IdDiff, SaveOption } from "@/lib/collectionDiff";
import { MAX_COLLECTION_DOCS } from "@/lib/collectionsLimits";
import { ghostBtn, primaryBtn } from "../modalStyles";
import type { Baseline } from "./useCollectionBaseline";

interface SaveChoiceViewProps {
  collectionName: string;
  baseline: Baseline;
  /** Selection against the saved docs; null until they have loaded. */
  diff: IdDiff | null;
  pending: boolean;
  /** The selection is over the collection size limit. */
  over: boolean;
  onUpdate: () => void;
  onSaveNew: (option: "new" | "without") => void;
  /** The option whose result the doc list shows (Update when the dialog opens). */
  previewing: SaveOption | null;
  /** Hover or focus: show this option's result, and keep it until another. */
  onPreview: (option: SaveOption) => void;
}

// The line over the buttons: how the selection now relates to the saved docs.
function comparison(name: string, baseline: Baseline, diff: IdDiff | null): string {
  if (baseline.status === "loading") return `Comparing with “${name}”…`;
  if (!diff) return `Couldn’t load “${name}” to compare it. Update replaces it with the selection.`;
  if (diff.added.length === 0 && diff.removed.length === 0) return `No changes since opening “${name}”.`;
  const n = diff.unchanged.length;
  return `You have made changes since opening “${name}” · ${n.toLocaleString()} ${n === 1 ? "doc overlaps" : "docs overlap"}`;
}

// One line each, sharing the row; a long collection name is cut with an ellipsis
// (the full label is the tooltip) rather than wrapping the row taller.
const rowBtn = { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;

// Update / Save as new / Save as new minus the opened collection's docs.
// Hovering or focusing a button previews what it would save in the doc list.
// Leaving does not undo it, so the list can be scrolled; the previewed button
// is ringed to say whose result the list shows.
export function SaveChoiceView({ collectionName, baseline, diff, pending, over, onUpdate, onSaveNew, previewing, onPreview }: SaveChoiceViewProps) {
  const without = diff?.added.length ?? 0;
  const withoutBlocked = !diff || without === 0 || without > MAX_COLLECTION_DOCS;
  const preview = (option: SaveOption) => ({
    onMouseEnter: () => onPreview(option),
    onFocus: () => onPreview(option),
    "data-previewing": previewing === option ? "true" : undefined,
  });
  const ring = (option: SaveOption) => (previewing === option ? { outline: "2px solid var(--accent)", outlineOffset: 2 } : undefined);
  const updateLabel = `Update “${collectionName}”`;
  const newLabel = "Save as new collection";
  const withoutLabel = `Save as new, minus “${collectionName}”`;
  const withoutTitle = !diff
    ? "Available once the saved collection has loaded"
    : without === 0
      ? `Nothing was added beyond “${collectionName}”`
      : undefined;
  return (
    <>
      <p className="mono" style={{ fontSize: 11, color: "var(--tan-2)", margin: 0 }}>
        {comparison(collectionName, baseline, diff)}
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          {...preview("update")}
          onClick={onUpdate}
          disabled={pending || over}
          title={updateLabel}
          className="mono"
          style={{ ...primaryBtn, ...rowBtn, ...ring("update"), opacity: pending || over ? 0.6 : 1 }}
        >
          {pending ? "saving…" : updateLabel}
        </button>
        <button
          {...preview("new")}
          onClick={() => onSaveNew("new")}
          disabled={pending}
          title={newLabel}
          className="mono"
          style={{ ...ghostBtn, ...rowBtn, ...ring("new") }}
        >
          {newLabel}
        </button>
        <button
          {...preview("without")}
          onClick={() => onSaveNew("without")}
          disabled={pending || withoutBlocked}
          title={withoutTitle ?? withoutLabel}
          className="mono"
          style={{ ...ghostBtn, ...rowBtn, ...ring("without"), opacity: withoutBlocked ? 0.6 : 1 }}
        >
          {withoutLabel}
        </button>
      </div>
    </>
  );
}
