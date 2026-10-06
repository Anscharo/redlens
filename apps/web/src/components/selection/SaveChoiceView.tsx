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
  /** The option whose result the doc list should show; null for the default. */
  onPreview: (option: SaveOption | null) => void;
}

// The line over the buttons: how the selection now relates to the saved docs.
function comparison(name: string, baseline: Baseline, diff: IdDiff | null): string {
  if (baseline.status === "loading") return `Comparing with “${name}”…`;
  if (!diff) return `Couldn’t load “${name}” to compare it. Update replaces it with the selection.`;
  if (diff.added.length === 0 && diff.removed.length === 0) return `No changes since opening “${name}”.`;
  const n = diff.unchanged.length;
  return `You have made changes since opening “${name}” · ${n.toLocaleString()} ${n === 1 ? "doc overlaps" : "docs overlap"}`;
}

// Update / Save as new / Save as new without the opened collection's docs.
// Hovering or focusing a button previews what it would save in the doc list.
export function SaveChoiceView({ collectionName, baseline, diff, pending, over, onUpdate, onSaveNew, onPreview }: SaveChoiceViewProps) {
  const without = diff?.added.length ?? 0;
  const withoutBlocked = !diff || without === 0 || without > MAX_COLLECTION_DOCS;
  const preview = (option: SaveOption) => ({
    onMouseEnter: () => onPreview(option),
    onFocus: () => onPreview(option),
    onMouseLeave: () => onPreview(null),
    onBlur: () => onPreview(null),
  });
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
      <button
        {...preview("update")}
        onClick={onUpdate}
        disabled={pending || over}
        className="mono"
        style={{ ...primaryBtn, opacity: pending || over ? 0.6 : 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {pending ? "saving…" : `Update “${collectionName}”`}
      </button>
      <button {...preview("new")} onClick={() => onSaveNew("new")} disabled={pending} className="mono" style={ghostBtn}>
        Save as new collection
      </button>
      <button
        {...preview("without")}
        onClick={() => onSaveNew("without")}
        disabled={pending || withoutBlocked}
        title={withoutTitle}
        className="mono"
        style={{ ...ghostBtn, textAlign: "left", opacity: withoutBlocked ? 0.6 : 1 }}
      >
        Save as new collection without docs from “{collectionName}”
      </button>
    </>
  );
}
