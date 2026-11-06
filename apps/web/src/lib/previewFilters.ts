import type { PreviewDiff } from "./previewDiff";

// The preview tree filters: one self-describing entry per filter. The filter
// menu, its counts, the `?change=` URL param and the filtered doc set all read
// this list, so a new filter is one appended entry (plus a group, if new).
//
// Filters in the same group combine by OR, groups combine by AND, and a group
// with nothing ticked does not narrow. Nothing ticked at all is "Changed only":
// every doc the preview adds or changes.
//
// The change kinds partition that set — every added or changed doc is exactly
// one of New, Edited or Renumbered only — so the kind group is `exhaustive`:
// the menu shows all its boxes ticked when none is (previewFilterTicks.ts).
// Retitled is a subset of Edited, so it is a flag, not a kind.

export const PREVIEW_FILTER_IDS = ["new", "edited", "renumbered", "retitled", "identity-swap", "reused-slot"] as const;
export type PreviewFilterId = (typeof PREVIEW_FILTER_IDS)[number];

export const PREVIEW_FILTER_GROUPS = [
  { id: "kind", label: "Change kind", exhaustive: true },
  { id: "flag", label: "Flags", exhaustive: false },
] as const;
export type PreviewFilterGroup = (typeof PREVIEW_FILTER_GROUPS)[number]["id"];

export interface PreviewFilterDef {
  id: PreviewFilterId;
  group: PreviewFilterGroup;
  label: string;
  /** Shown beside the label: the same mark the tree and reader use. */
  glyph: string;
  description: string;
  /** The doc ids this filter keeps, or null when this preview's bundle was
   *  built before the field it reads existed (the menu greys the row out). */
  ids: (diff: PreviewDiff) => ReadonlySet<string> | null;
}

const keys = (o: Record<string, unknown>): Set<string> => new Set(Object.keys(o));

function edited(diff: PreviewDiff): Set<string> | null {
  const only = diff.renumberedOnly;
  if (!only) return null;
  return new Set([...diff.changed].filter((id) => !only.has(id)));
}

export const PREVIEW_FILTERS: readonly PreviewFilterDef[] = [
  { id: "new", group: "kind", label: "New", glyph: "+", description: "Documents this preview adds", ids: (d) => d.added },
  { id: "edited", group: "kind", label: "Edited", glyph: "Δ", description: "Changed in title or text, not just renumbered", ids: edited },
  {
    id: "renumbered",
    group: "kind",
    label: "Renumbered only",
    glyph: "↻",
    description: "Only the doc number changed",
    ids: (d) => d.renumberedOnly ?? null,
  },
  { id: "retitled", group: "flag", label: "Retitled", glyph: "T", description: "The title changed", ids: (d) => keys(d.retitled) },
  {
    id: "identity-swap",
    group: "flag",
    label: "Identity swap",
    glyph: "⚠",
    description: "A kept UUID now points at a different document",
    ids: (d) => keys(d.identitySwap),
  },
  {
    id: "reused-slot",
    group: "flag",
    label: "Reused doc number",
    glyph: "#",
    description: "A new document at a doc number another document held",
    ids: (d) => keys(d.reusedSlot),
  },
];

export interface PreviewFilterPreset {
  label: string;
  description: string;
  filters: readonly PreviewFilterId[];
}

export const PREVIEW_FILTER_PRESETS: readonly PreviewFilterPreset[] = [
  { label: "Changed only", description: "Every document this preview adds or changes", filters: [] },
];

function sameFilters(a: readonly PreviewFilterId[], b: readonly PreviewFilterId[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

export function matchingPreset(selected: readonly PreviewFilterId[]): PreviewFilterPreset | undefined {
  return PREVIEW_FILTER_PRESETS.find((p) => sameFilters(p.filters, selected));
}

/** Whether every filter the preset ticks can be answered by this bundle. */
export function presetAvailable(preset: PreviewFilterPreset, diff: PreviewDiff): boolean {
  return preset.filters.every((id) => PREVIEW_FILTERS.find((f) => f.id === id)?.ids(diff) !== null);
}

/** What the filter button says for the current selection. */
export function describeFilters(selected: readonly PreviewFilterId[]): string {
  const preset = matchingPreset(selected);
  if (preset) return preset.label;
  return PREVIEW_FILTERS.filter((f) => selected.includes(f.id))
    .map((f) => f.label)
    .join(" · ");
}

/** The doc ids the selected filters keep, in no particular order. */
export function filterPreviewDocs(diff: PreviewDiff, selected: readonly PreviewFilterId[]): Set<string> {
  let kept = new Set<string>([...diff.added, ...diff.changed]);
  for (const group of PREVIEW_FILTER_GROUPS) {
    const picked = PREVIEW_FILTERS.filter((f) => f.group === group.id && selected.includes(f.id));
    if (!picked.length) continue;
    const union = new Set<string>();
    for (const f of picked) for (const id of f.ids(diff) ?? []) union.add(id);
    kept = new Set([...kept].filter((id) => union.has(id)));
  }
  return kept;
}
