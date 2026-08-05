import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAtlasSubset } from "./atlasSubset";
import { loadSelection, saveSelection, STORAGE_KEY } from "./selectionStore";

// "Document Selection" state: the set of doc ids a user has picked (for a
// collection/export flow), plus the "selected only" view toggle and the
// currently active collection (if any). Persisted to localStorage; the
// selected-only toggle is URL-synced as `subset=selected`, matching the
// preview `subset=changed` filter namespace.
interface Selection {
  ids: Set<string>;
  /** Toggle a single doc's membership (the per-document checkbox). */
  toggleDoc: (id: string) => void;
  /** Toggle a whole subtree at once (a doc + all its descendants), keyed on the
   *  root's current membership: if the root is selected, the whole set is
   *  removed; otherwise the whole set is added. Backs shift-clicking a node's
   *  expand toggle. The caller passes the flattened id list (root first). */
  selectSubtree: (ids: string[]) => void;
  clear: () => void;
  replace: (ids: string[]) => void;
  selectedOnly: boolean;
  setSelectedOnly: (v: boolean) => void;
  activeCollectionId: string | null;
  setActiveCollectionId: (id: string | null) => void;
  /** Name of the currently-open collection, if any — shown in the view pill
   *  ("NAME · n") in place of the generic "Selected · n". */
  activeCollectionName: string | null;
  setActiveCollectionName: (name: string | null) => void;
}

// A stable no-op default so components rendered WITHOUT the provider (e.g. the
// reader in preview mode, where SelectionProvider is intentionally not mounted)
// don't crash — they just see an empty, inert selection. Mirrors the
// non-throwing usePreviewView() pattern.
const EMPTY_IDS: ReadonlySet<string> = new Set();
const NOOP_SELECTION: Selection = {
  ids: EMPTY_IDS as Set<string>,
  toggleDoc: () => {},
  selectSubtree: () => {},
  clear: () => {},
  replace: () => {},
  selectedOnly: false,
  setSelectedOnly: () => {},
  activeCollectionId: null,
  setActiveCollectionId: () => {},
  activeCollectionName: null,
  setActiveCollectionName: () => {},
};

const SelectionContext = createContext<Selection>(NOOP_SELECTION);

export function useSelection(): Selection {
  return useContext(SelectionContext);
}

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState<Set<string>>(() => new Set(loadSelection()));
  const [subset, setSubset] = useAtlasSubset();
  const selectedOnly = subset === "selected";
  const setSelectedOnly = useCallback((v: boolean) => setSubset(v ? "selected" : "all"), [setSubset]);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [activeCollectionName, setActiveCollectionName] = useState<string | null>(null);
  // True when the most recent mutation to `ids` was a bulk replace() (loading a
  // collection wholesale) rather than an interactive add/remove/clear. Read by
  // the empties-effect below to tell "the user just opened a collection that
  // happens to be empty" apart from "the user emptied the selection by hand" —
  // see that effect's comment. A ref (not state) on purpose: flipping it must
  // never itself trigger a render or a "did it change" dependency check, it
  // only needs to be the right value by the time the effect below next runs.
  // Persists (isn't auto-consumed) across an effect run that bails early, so a
  // second firing from `selectedOnly` alone — e.g. once the `subset=selected`
  // navigation after a collection open lands a tick later — still bails too;
  // only the next interactive mutator (toggleDoc/selectSubtree/clear) clears it.
  const openedFromReplaceRef = useRef(false);

  useEffect(() => {
    saveSelection([...ids]);
  }, [ids]);

  // When the selection empties by user action (unchecking the last doc,
  // deselecting the last subtree, or an explicit clear), drop back to "All" so
  // the filter doesn't stay armed and snap the next checked doc into a hidden
  // selected-only view, and forget any active collection — an empty set is no
  // longer "that collection", so the next docs picked start fresh/unnamed
  // (otherwise the pill keeps the old name and Save offers a stale "Update").
  //
  // Deliberately opening an EMPTY collection also drives ids to size 0 (via
  // replace([]), from CollectionsPage's openCollection or the /c/:id opener)
  // but must NOT hit this reset: that would silently strip subset=selected
  // back out of the URL and drop the collection's id/name, dumping the user
  // onto the full atlas with no explanation and no way back to the collection
  // they just clicked (2026-08-02 QA report, C4). openedFromReplaceRef tells
  // the two apart.
  //
  // Bailing here is necessary but NOT sufficient for correct ownership
  // context: it only means this effect leaves activeCollectionId/Name exactly
  // as they already were — it does not set the *right* id for whichever
  // collection replace() just loaded. That's on the caller, right alongside
  // its replace() call: CollectionsPage's openCollection sets the collection's
  // own (non-null) id, since the user owns it. SharedCollectionOpener sets it
  // to null, since a shared collection never is the viewer's to overwrite —
  // a stale id from a previously-active OWN collection must not survive an
  // empty replace() here undetected, or Save's "Update" can PATCH the wrong
  // collection to empty (P1 data-loss bug, PR #230 review, 2026-08-03).
  useEffect(() => {
    if (ids.size > 0) return;
    if (openedFromReplaceRef.current) return;
    if (selectedOnly) setSelectedOnly(false);
    setActiveCollectionId(null);
    setActiveCollectionName(null);
  }, [selectedOnly, ids, setSelectedOnly]);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setIds(new Set(loadSelection()));
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const toggleDoc = useCallback((id: string) => {
    openedFromReplaceRef.current = false;
    setIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectSubtree = useCallback((subtreeIds: string[]) => {
    if (subtreeIds.length === 0) return;
    openedFromReplaceRef.current = false;
    setIds((prev) => {
      const next = new Set(prev);
      // Root-keyed toggle: an already-selected root deselects the whole subtree,
      // otherwise the whole subtree is added.
      if (next.has(subtreeIds[0])) {
        for (const sid of subtreeIds) next.delete(sid);
      } else {
        for (const sid of subtreeIds) next.add(sid);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    openedFromReplaceRef.current = false;
    setIds(new Set());
  }, []);

  // Bulk load — used to open a collection wholesale (CollectionsPage,
  // SharedCollectionOpener). Marks openedFromReplaceRef so the empties-effect
  // above doesn't mistake a deliberately-empty collection for a drained one.
  const replace = useCallback((newIds: string[]) => {
    openedFromReplaceRef.current = true;
    setIds(new Set(newIds));
  }, []);

  const value = useMemo<Selection>(
    () => ({
      ids,
      toggleDoc,
      selectSubtree,
      clear,
      replace,
      selectedOnly,
      setSelectedOnly,
      activeCollectionId,
      setActiveCollectionId,
      activeCollectionName,
      setActiveCollectionName,
    }),
    [ids, toggleDoc, selectSubtree, clear, replace, selectedOnly, setSelectedOnly, activeCollectionId, activeCollectionName],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}
