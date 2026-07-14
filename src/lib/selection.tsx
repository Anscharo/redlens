import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useUrlState, urlBool } from "../hooks/useUrlState";
import { loadSelection, saveSelection, STORAGE_KEY } from "./selectionStore";

// "Document Selection" state: the set of doc ids a user has picked (for a
// collection/export flow), plus the "selected only" view toggle and the
// currently active collection (if any). Persisted to localStorage; the
// selected-only toggle is URL-synced like other view filters.
interface Selection {
  ids: Set<string>;
  toggle: (id: string) => void;
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
  toggle: () => {},
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

  const toggle = useCallback((id: string) => {
    setIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
      toggle,
      add,
      remove,
      clear,
      replace,
      selectedOnly,
      setSelectedOnly,
      activeCollectionId,
      setActiveCollectionId,
    }),
    [ids, toggle, add, remove, clear, replace, selectedOnly, setSelectedOnly, activeCollectionId],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}
