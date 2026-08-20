import { useCallback, useRef, useState } from "react";
import type { RefObject } from "react";
import { DEFAULT_RUNG, type Rung, type RungLevel } from "./subtreeState";

// Owns the reader's per-node rung map (see subtreeState.ts for the pendulum
// model). Split out of AtlasReader.tsx so that already-oversized file doesn't
// grow further for this feature.
export function useRungs(): {
  rung: ReadonlyMap<string, Rung>;
  rungRef: RefObject<ReadonlyMap<string, Rung>>;
  writeRungs: (updates: Iterable<[string, Rung]>) => void;
  revealTo: (ids: string[], minLevel: RungLevel) => void;
} {
  const [rung, setRung] = useState<ReadonlyMap<string, Rung>>(() => new Map());
  // expandedSetRef-style latest-value ref (see AtlasReader) so callers that
  // must read the current rung inside a click handler (before this render's
  // state has committed) get the up-to-date map without depending on it.
  const rungRef = useRef<ReadonlyMap<string, Rung>>(rung);
  rungRef.current = rung;

  // Writes an arbitrary batch of rungs. Returns the previous Map identity
  // when nothing actually changes — load-bearing: useAtlasScroll keys its
  // re-scroll off that identity, and docList depends on `rung` too.
  const writeRungs = useCallback((updates: Iterable<[string, Rung]>) => {
    setRung((prev) => {
      let next: Map<string, Rung> | null = null;
      for (const [id, r] of updates) {
        const cur = prev.get(id) ?? DEFAULT_RUNG;
        if (cur.level === r.level && cur.dir === r.dir) continue;
        if (!next) next = new Map(prev);
        next.set(id, r);
      }
      return next ?? prev;
    });
  }, []);

  // Navigation reveal: raises rungs to at least minLevel, monotonically, and
  // never lowers or touches an already-sufficient rung — so it can never
  // collapse a branch the user had open elsewhere. Never writes body state.
  const revealTo = useCallback((ids: string[], minLevel: RungLevel) => {
    setRung((prev) => {
      let next: Map<string, Rung> | null = null;
      for (const id of ids) {
        const cur = prev.get(id) ?? DEFAULT_RUNG;
        if (cur.level >= minLevel) continue;
        if (!next) next = new Map(prev);
        next.set(id, { level: minLevel, dir: 1 });
      }
      return next ?? prev;
    });
  }, []);

  return { rung, rungRef, writeRungs, revealTo };
}
