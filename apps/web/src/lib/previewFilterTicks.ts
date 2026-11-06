import type { PreviewDiff } from "./previewDiff";
import { PREVIEW_FILTER_GROUPS, PREVIEW_FILTER_IDS, PREVIEW_FILTERS, type PreviewFilterId } from "./previewFilters";

// Which boxes the preview filter menu shows ticked, and what a click on one
// writes to the URL. An exhaustive group (the change kinds) covers every
// change between its filters, so "none ticked" and "all ticked" keep the same
// docs: the menu shows the first as the second, and the URL stores the second
// as the first, so "Changed only" stays one clean URL whichever way it is
// reached.

const EXHAUSTIVE = PREVIEW_FILTER_GROUPS.filter((g) => g.exhaustive).map((g) => g.id as string);
const inGroup = (group: string) => PREVIEW_FILTERS.filter((f) => f.group === group);

/** The boxes to show ticked for this selection. */
export function tickedFilters(selected: readonly PreviewFilterId[]): PreviewFilterId[] {
  const ticked = new Set(selected);
  for (const group of EXHAUSTIVE) {
    const members = inGroup(group);
    if (!members.some((f) => ticked.has(f.id))) for (const f of members) ticked.add(f.id);
  }
  return PREVIEW_FILTER_IDS.filter((id) => ticked.has(id));
}

/** The selection to store after a box is ticked or unticked. */
export function toggleFilter(selected: readonly PreviewFilterId[], id: PreviewFilterId, on: boolean, diff: PreviewDiff): PreviewFilterId[] {
  const shown = tickedFilters(selected);
  const next = new Set(on ? [...shown, id] : shown.filter((f) => f !== id));
  for (const group of EXHAUSTIVE) {
    const available = inGroup(group).filter((f) => f.ids(diff) !== null);
    if (available.every((f) => next.has(f.id))) for (const f of inGroup(group)) next.delete(f.id);
  }
  return PREVIEW_FILTER_IDS.filter((f) => next.has(f));
}

/** A ticked box that is the last available one in an exhaustive group: it
 *  cannot be unticked, since an empty exhaustive group would show nothing. */
export function isLastTicked(id: PreviewFilterId, selected: readonly PreviewFilterId[], diff: PreviewDiff): boolean {
  const def = PREVIEW_FILTERS.find((f) => f.id === id);
  if (!def || !EXHAUSTIVE.includes(def.group)) return false;
  const ticked = tickedFilters(selected);
  const live = inGroup(def.group).filter((f) => f.ids(diff) !== null && ticked.includes(f.id));
  return live.length === 1 && live[0].id === id;
}
