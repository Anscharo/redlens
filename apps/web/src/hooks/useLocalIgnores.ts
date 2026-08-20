import { useCallback, useEffect, useMemo, useState } from "react";
import {
  loadLocalIgnores,
  saveLocalIgnores,
  STORAGE_KEY,
  type LocalIgnore,
} from "../lib/curationStore";

export function useLocalIgnores() {
  const [marks, setMarks] = useState<LocalIgnore[]>(() => loadLocalIgnores());

  useEffect(() => {
    saveLocalIgnores(marks);
  }, [marks]);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setMarks(loadLocalIgnores());
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const byUuid = useMemo(() => new Map(marks.map((m) => [m.uuid, m])), [marks]);

  const mark = useCallback(
    (uuid: string, reason: string) =>
      setMarks((prev) => [
        ...prev.filter((m) => m.uuid !== uuid),
        { uuid, reason, marked_at: new Date().toISOString() },
      ]),
    [],
  );

  const unmark = useCallback(
    (uuid: string) => setMarks((prev) => prev.filter((m) => m.uuid !== uuid)),
    [],
  );

  const clear = useCallback(() => setMarks([]), []);

  return { marks, byUuid, mark, unmark, clear };
}
