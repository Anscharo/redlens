import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useUrlState, urlBool } from "../hooks/useUrlState";
import { loadSelection, saveSelection, STORAGE_KEY } from "./selectionStore";

// "Document Selection" state: the set of doc ids a user has picked (for a
// collection/export flow), plus the "selected only" view toggle and the
// currently active collection (if any). Persisted to localStorage; the
// selected-only toggle is URL-synced like other view filters.
interface Selection {
  ids: Set<string>;
  /** Whether selection mode is active — when on, the reader shows a checkbox on
   *  every document. Off by default so the checkboxes don't always show. */
  selectionMode: boolean;
  setSelectionMode: (v: boolean) => void;
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
  selectionMode: false,
  setSelectionMode: () => {},
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
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedOnly, setSelectedOnly] = useUrlState("selectedOnly", urlBool(false));
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [activeCollectionName, setActiveCollectionName] = useState<string | null>(null);

  useEffect(() => {
    saveSelection([...ids]);
  }, [ids]);

  // When the selection empties (e.g. the user unchecks the last doc), drop back
  // to "All" so the filter doesn't stay armed and snap the next checked doc into
  // a hidden selected-only view, and forget any active collection — an empty set
  // is no longer "that collection", so the next docs picked start fresh/unnamed
  // (otherwise the pill keeps the old name and Save offers a stale "Update").
  useEffect(() => {
    if (ids.size > 0) return;
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
    setIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectSubtree = useCallback((subtreeIds: string[]) => {
    if (subtreeIds.length === 0) return;
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

  const clear = useCallback(() => setIds(new Set()), []);

  const replace = useCallback((newIds: string[]) => setIds(new Set(newIds)), []);

  const value = useMemo<Selection>(
    () => ({
      ids,
      selectionMode,
      setSelectionMode,
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
    [ids, selectionMode, toggleDoc, selectSubtree, clear, replace, selectedOnly, setSelectedOnly, activeCollectionId, activeCollectionName],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}
