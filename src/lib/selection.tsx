import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  toggle: (id: string) => void;
  /** Checkbox toggle with shift-click range support: on shift, selects every
   *  currently-visible doc between the last-toggled anchor and `id`. */
  rangeToggle: (id: string, shift: boolean) => void;
  /** Register the reader's current ordered list of visible doc ids, so
   *  rangeToggle knows what "between" means in the view the user sees. */
  setVisibleOrder: (ids: string[]) => void;
  add: (id: string) => void;
  remove: (id: string) => void;
  clear: () => void;
  replace: (ids: string[]) => void;
  selectedOnly: boolean;
  setSelectedOnly: (v: boolean) => void;
  activeCollectionId: string | null;
  setActiveCollectionId: (id: string | null) => void;
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
  toggle: () => {},
  rangeToggle: () => {},
  setVisibleOrder: () => {},
  add: () => {},
  remove: () => {},
  clear: () => {},
  replace: () => {},
  selectedOnly: false,
  setSelectedOnly: () => {},
  activeCollectionId: null,
  setActiveCollectionId: () => {},
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

  useEffect(() => {
    saveSelection([...ids]);
  }, [ids]);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setIds(new Set(loadSelection()));
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  // The reader's current ordered visible doc ids, and the last checkbox the user
  // toggled (the anchor for a subsequent shift-click range). Refs, not state:
  // they feed an imperative handler and must never trigger a re-render.
  const orderRef = useRef<string[]>([]);
  const anchorRef = useRef<string | null>(null);

  const setVisibleOrder = useCallback((order: string[]) => {
    orderRef.current = order;
  }, []);

  const toggle = useCallback((id: string) => {
    setIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchorRef.current = id;
  }, []);

  const rangeToggle = useCallback((id: string, shift: boolean) => {
    const order = orderRef.current;
    const anchor = anchorRef.current;
    if (shift && anchor && anchor !== id) {
      const a = order.indexOf(anchor);
      const b = order.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        // Shift-select adds the whole visible span (anchor included) — it never
        // deselects, matching the common list range-select convention.
        setIds((prev) => {
          const next = new Set(prev);
          for (let k = lo; k <= hi; k++) next.add(order[k]);
          return next;
        });
        anchorRef.current = id;
        return;
      }
    }
    setIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchorRef.current = id;
  }, []);

  const add = useCallback((id: string) => {
    setIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  const remove = useCallback((id: string) => {
    setIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
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
      toggle,
      rangeToggle,
      setVisibleOrder,
      add,
      remove,
      clear,
      replace,
      selectedOnly,
      setSelectedOnly,
      activeCollectionId,
      setActiveCollectionId,
    }),
    [ids, selectionMode, toggle, rangeToggle, setVisibleOrder, add, remove, clear, replace, selectedOnly, setSelectedOnly, activeCollectionId],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}
