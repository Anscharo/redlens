import type { PreviewDiff } from "./previewDiff";

// The preview tree filters: one self-describing entry per filter. The filter
// menu, its counts, the `?change=` URL param and the filtered doc set all read
// this list, so a new filter is one appended entry (plus a group, if new).
//
// Filters in the same group combine by OR, groups combine by AND, and a group
// with nothing ticked does not narrow. Nothing ticked at all is "Changed only":
// every doc the preview adds or changes.
//
// New and Edited split that set in two, so the kind group is `exhaustive`:
// the menu shows both ticked when neither is stored (previewFilterTicks.ts).
//
// An `exclude` filter, ticked, removes its docs from whatever the rest keep.
// "Renumber-only changes" is one, so the doc-number-only changes Edited counts
// can be hidden.

export const PREVIEW_FILTER_IDS = ["new", "edited", "no-renumbered", "retitled", "identity-swap", "reused-slot"] as const;
export type PreviewFilterId = (typeof PREVIEW_FILTER_IDS)[number];

export const PREVIEW_FILTER_GROUPS = [
  { id: "kind", label: "Change kind", exhaustive: true },
  { id: "exclude", label: "Exclude", exhaustive: false },
  { id: "flag", label: "Flags", exhaustive: false },
] as const;
export type PreviewFilterGroup = (typeof PREVIEW_FILTER_GROUPS)[number]["id"];

export interface PreviewFilterDef {
  id: PreviewFilterId;
  group: PreviewFilterGroup;
  /** Removes its docs instead of keeping them (see above). */
  exclude?: boolean;
  label: string;
  /** What the filter button says for it, if not the label. */
  short?: string;
  /** Shown beside the label: the same mark the tree and reader use. */
  glyph: string;
  description: string;
  /** The doc ids this filter matches, or null when this preview's bundle was
   *  built before the field it reads existed (the menu greys the row out). */
  ids: (diff: PreviewDiff) => ReadonlySet<string> | null;
}

const keys = (o: Record<string, unknown>): Set<string> => new Set(Object.keys(o));

export const PREVIEW_FILTERS: readonly PreviewFilterDef[] = [
  { id: "new", group: "kind", label: "New", glyph: "+", description: "Documents this preview adds", ids: (d) => d.added },
  {
    id: "edited",
    group: "kind",
    label: "Edited",
    glyph: "Δ",
    description: "Documents this preview changes, including doc-number-only changes",
    ids: (d) => d.changed,
  },
  {
    id: "no-renumbered",
    group: "exclude",
    exclude: true,
    label: "Renumber-only changes",
    short: "No renumbers",
    glyph: "↻",
    description: "Hide documents whose only change is the doc number",
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
  const picked = PREVIEW_FILTERS.filter((f) => selected.includes(f.id));
  const narrowing = picked.filter((f) => !f.exclude).map((f) => f.short ?? f.label);
  const excluding = picked.filter((f) => f.exclude).map((f) => f.short ?? f.label);
  return [...(narrowing.length ? narrowing : [PREVIEW_FILTER_PRESETS[0].label]), ...excluding].join(" · ");
}

/** The doc ids the selected filters keep, in no particular order. */
export function filterPreviewDocs(diff: PreviewDiff, selected: readonly PreviewFilterId[]): Set<string> {
  let kept = new Set<string>([...diff.added, ...diff.changed]);
  for (const group of PREVIEW_FILTER_GROUPS) {
    const picked = PREVIEW_FILTERS.filter((f) => f.group === group.id && !f.exclude && selected.includes(f.id));
    if (!picked.length) continue;
    const union = new Set<string>();
    for (const f of picked) for (const id of f.ids(diff) ?? []) union.add(id);
    kept = new Set([...kept].filter((id) => union.has(id)));
  }
  for (const f of PREVIEW_FILTERS) {
    if (!f.exclude || !selected.includes(f.id)) continue;
    const drop = f.ids(diff);
    if (drop) kept = new Set([...kept].filter((id) => !drop.has(id)));
  }
  return kept;
}
