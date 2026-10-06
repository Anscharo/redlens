import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// The collection the selection was opened from, if any: `id` only for one the
// viewer owns (Save can "Update" it), `name` for the view pill.
//
// A manual edit makes the selection something other than the collection that
// was opened. An owned collection keeps its name; a shared or conversation-built
// one has no id, is not theirs to overwrite, and stops claiming its name — the
// pill falls back to "Selected". Opening a collection (replace) is not an edit.
export function useActiveCollection() {
  const [id, setId] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  // Mirror of `id` for the stable edit callbacks that call dropUnownedName.
  const idRef = useRef<string | null>(null);
  useEffect(() => {
    idRef.current = id;
  }, [id]);
  const dropUnownedName = useCallback(() => {
    if (idRef.current === null) setName(null);
  }, []);
  const resetCollection = useCallback(() => {
    setId(null);
    setName(null);
  }, []);
  const collection = useMemo(
    () => ({ activeCollectionId: id, setActiveCollectionId: setId, activeCollectionName: name, setActiveCollectionName: setName }),
    [id, name],
  );
  return { collection, dropUnownedName, resetCollection };
}
