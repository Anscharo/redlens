import { useCallback } from "react";
import { ROUTES } from "@/lib/routes";
import { useDataSource } from "./dataSource";
import { usePreviewDiff } from "./previewDiff";
import { usePreviewView } from "./previewView";
import { useSelectionSet } from "./selectionFilter";

/** True for a doc the active subset filter (preview "changed only", "selected
 *  only", an open collection) leaves out of the reader. The reader and tree
 *  list only the filtered docs, so a hidden doc has no row to open there.
 *  Same precedence as the reader's `changedSet ?? selectionSet`. Checks
 *  membership directly rather than building a set, so every link can call it. */
export function useFilterHides(): (id: string) => boolean {
  const { preview } = useDataSource();
  const { onlyChanged } = usePreviewView();
  const diff = usePreviewDiff();
  const selection = useSelectionSet();
  return useCallback(
    (id: string) => {
      if (preview && onlyChanged) return !diff.added.has(id) && !diff.changed.has(id);
      return !!selection && !selection.has(id);
    },
    [preview, onlyChanged, diff, selection],
  );
}

const KEPT_FOR_SPLIT = ["id", "view", "subset"] as const;

/** The /atlas URL that opens `id` in the comparison pane and leaves the reader,
 *  its breadcrumbs, its panel tab and its filter where `live` has them. This is
 *  where a link to a filter-hidden doc goes: moving the reader there would
 *  change the breadcrumbs and show nothing. */
export function splitHref(id: string, live: URLSearchParams): string {
  const params = new URLSearchParams();
  for (const key of KEPT_FOR_SPLIT) {
    const value = live.get(key);
    if (value) params.set(key, value);
  }
  params.set("split", id);
  return `${ROUTES.ATLAS}?${params}`;
}
