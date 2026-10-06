// What saving a selection over (or beside) an opened collection would change.
// Pure and import-free so the save dialog's preview and its tests need no React.

export type RowMark = "add" | "remove" | "same";

export interface PreviewRow {
  id: string;
  mark: RowMark;
}

export interface IdDiff {
  /** In the selection, not in the saved collection (selection order). */
  added: string[];
  /** In the saved collection, not in the selection (saved order). */
  removed: string[];
  /** In both (selection order). */
  unchanged: string[];
}

const unique = (ids: readonly string[]): string[] => [...new Set(ids)];

export function diffIds(saved: readonly string[], selection: readonly string[]): IdDiff {
  const savedSet = new Set(saved);
  const selectedSet = new Set(selection);
  const picked = unique(selection);
  return {
    added: picked.filter((id) => !savedSet.has(id)),
    removed: unique(saved).filter((id) => !selectedSet.has(id)),
    unchanged: picked.filter((id) => savedSet.has(id)),
  };
}

/** The selection without the saved collection's docs: what was added beyond it. */
export function subtractIds(selection: readonly string[], saved: readonly string[]): string[] {
  return diffIds(saved, selection).added;
}

/** Update's preview: removed rows first, then added, then unchanged, so a
 *  truncated list never hides a change behind unchanged rows. */
export function diffRows({ added, removed, unchanged }: IdDiff): PreviewRow[] {
  return [
    ...removed.map((id): PreviewRow => ({ id, mark: "remove" })),
    ...added.map((id): PreviewRow => ({ id, mark: "add" })),
    ...unchanged.map((id): PreviewRow => ({ id, mark: "same" })),
  ];
}

/** The three ways to save over an opened collection. */
export type SaveOption = "update" | "new" | "without";

export interface Preview {
  /** The rows to list, in display order. */
  ids: string[];
  /** How many docs the save would write. Not `ids.length` for Update, whose
   *  rows also list the removed docs. */
  count: number;
  /** Per-id marks; only Update has any (+/−). */
  marks?: Map<string, RowMark>;
  /** One line over the list; only Update has one. */
  summary?: string;
}

/** What `option` would leave in the saved collection. Without the saved docs
 *  (`saved` null: no collection open, or its copy has not loaded) every option
 *  is just the selection. */
export function previewFor(option: SaveOption, selection: readonly string[], saved: readonly string[] | null): Preview {
  if (!saved || option === "new") return { ids: [...selection], count: selection.length };
  const diff = diffIds(saved, selection);
  if (option === "without") return { ids: diff.added, count: diff.added.length };
  const rows = diffRows(diff);
  return {
    ids: rows.map((r) => r.id),
    count: diff.added.length + diff.unchanged.length,
    marks: new Map(rows.map((r) => [r.id, r.mark])),
    summary: `+${diff.added.length} added · −${diff.removed.length} removed · ${diff.unchanged.length} unchanged`,
  };
}
