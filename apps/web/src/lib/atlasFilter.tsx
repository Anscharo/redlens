import { createContext, useContext, useMemo, type ReactNode } from "react";
import { ROUTES } from "@/lib/routes";
import { usePreviewChangedSet } from "./previewFilter";
import { useSelectionSet } from "./selectionFilter";

/** The doc ids the reader and tree are narrowed to: a preview's "changed only"
 *  wins over "selected only" (which is also how an open collection shows).
 *  null when nothing is filtered. The one statement of that precedence. */
export function useAtlasFilterSet(): Set<string> | null {
  const changed = usePreviewChangedSet();
  const selected = useSelectionSet();
  return changed ?? selected;
}

const HIDES_NOTHING = (): boolean => false;
const FilterHidesContext = createContext<(id: string) => boolean>(HIDES_NOTHING);

/** Works out the filter once for the app, so the many links asking "is this
 *  doc hidden?" re-render only when the filter changes, not on every checkbox
 *  tick in the All view. It reads the same set as the reader and tree, so a
 *  preview diff still loading hides nothing anywhere (see previewFilter.ts). */
export function AtlasFilterProvider({ children }: { children: ReactNode }) {
  const set = useAtlasFilterSet();
  const hides = useMemo(() => (set ? (id: string) => !set.has(id) : HIDES_NOTHING), [set]);
  return <FilterHidesContext.Provider value={hides}>{children}</FilterHidesContext.Provider>;
}

/** True for a doc the active subset filter leaves out of the reader, which
 *  lists only filtered docs and so has no row to open it at. */
export function useFilterHides(): (id: string) => boolean {
  return useContext(FilterHidesContext);
}

/** Where a link to a filter-hidden doc lands. `split`: beside the reader's doc,
 *  which stays put with its breadcrumbs, tab and filter. `read`: in the reader,
 *  unfiltered, when there is no reader doc to keep. `stay`: it is already the
 *  reader's doc (reached by URL), so nothing moves. */
export type HiddenTarget = { kind: "split" | "read" | "stay"; href: string };

// `base` is a preview's diff base (?base=): dropping it would refetch a
// different diff and change which docs the filter lists.
const KEPT_BESIDE = ["id", "view", "subset", "base"] as const;

function atlasUrl(params: URLSearchParams): string {
  return `${ROUTES.ATLAS}?${params}`;
}

export function hiddenTargetHref(id: string, live: URLSearchParams): HiddenTarget {
  const reading = live.get("id");
  const split = live.get("split");
  if (!reading) {
    const params = new URLSearchParams({ id });
    if (split && split !== id) params.set("split", split);
    const base = live.get("base");
    if (base) params.set("base", base);
    return { kind: "read", href: atlasUrl(params) };
  }
  const params = new URLSearchParams();
  for (const key of KEPT_BESIDE) {
    const value = live.get(key);
    if (value) params.set(key, value);
  }
  if (reading === id) {
    if (split) params.set("split", split);
    return { kind: "stay", href: atlasUrl(params) };
  }
  params.set("split", id);
  return { kind: "split", href: atlasUrl(params) };
}
