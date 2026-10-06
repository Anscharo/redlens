import type { CSSProperties, ReactNode } from "react";
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
const ring = { outline: "2px solid var(--accent)", outlineOffset: 2 } as const;

interface OptionButtonProps {
  option: SaveOption;
  previewing: SaveOption | null;
  onPreview: (option: SaveOption) => void;
  onClick: () => void;
  base: CSSProperties;
  disabled: boolean;
  title: string;
  children: ReactNode;
}

// Hovering or focusing previews the option; the previewed button is ringed to
// say whose result the doc list shows. Leaving does not undo it.
function OptionButton({ option, previewing, onPreview, onClick, base, disabled, title, children }: OptionButtonProps) {
  const previewed = previewing === option;
  return (
    <button
      onMouseEnter={() => onPreview(option)}
      onFocus={() => onPreview(option)}
      data-previewing={previewed ? "true" : undefined}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="mono"
      style={{ ...base, ...rowBtn, ...(previewed ? ring : null), opacity: disabled ? 0.6 : 1 }}
    >
      {children}
    </button>
  );
}

// Update / Save as new / Save as new minus the opened collection's docs.
export function SaveChoiceView({ collectionName, baseline, diff, pending, over, onUpdate, onSaveNew, previewing, onPreview }: SaveChoiceViewProps) {
  const added = diff?.added.length ?? 0;
  const minusBlocked = !diff || added === 0 || added > MAX_COLLECTION_DOCS;
  const updateLabel = `Update “${collectionName}”`;
  const minusLabel = `Save as new, minus “${collectionName}”`;
  const minusReason = !diff ? "Available once the saved collection has loaded" : added === 0 ? `Nothing was added beyond “${collectionName}”` : minusLabel;
  const shared = { previewing, onPreview };
  return (
    <>
      <p className="mono" style={{ fontSize: 11, color: "var(--tan-2)", margin: 0 }}>
        {comparison(collectionName, baseline, diff)}
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <OptionButton {...shared} option="update" onClick={onUpdate} base={primaryBtn} disabled={pending || over} title={updateLabel}>
          {pending ? "saving…" : updateLabel}
        </OptionButton>
        <OptionButton {...shared} option="new" onClick={() => onSaveNew("new")} base={ghostBtn} disabled={pending} title="Save as new collection">
          Save as new collection
        </OptionButton>
        <OptionButton {...shared} option="without" onClick={() => onSaveNew("without")} base={ghostBtn} disabled={pending || minusBlocked} title={minusReason}>
          {minusLabel}
        </OptionButton>
      </div>
    </>
  );
}
