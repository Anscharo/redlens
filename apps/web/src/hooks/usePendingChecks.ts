import { useEffect, useMemo, useState } from "react";
import type { HistoryEntry } from "@/lib/history";
import { loadHistoryBatch } from "@/lib/history";
import type { StoredPauSnapshot } from "@/lib/pau";
import type { ValueCheck } from "@/lib/pauAtlasValues";
import { mismatchDocs, withPending } from "@/lib/pauPending";
import { loadPauHistory } from "../lib/pau";
import { loadVoteIndex } from "../lib/votes";
import { useLoaded } from "./useAtlasData";

/**
 * The checks with each mismatch the chain is still expected to catch up on
 * marked `pending` (src/lib/pauPending.ts), judged against the prime's
 * snapshots, the PAU change history and the vote record. Reads the document
 * history of only the documents stating a mismatch; until it and the PAU
 * history land, and without a backend, the checks come back as they are, so a
 * mismatch is never hidden by a failed read.
 */
export function usePendingChecks(checks: ValueCheck[], snaps: readonly StoredPauSnapshot[]): ValueCheck[] {
  const votes = useLoaded(loadVoteIndex, { soft: true });
  const pau = useLoaded(loadPauHistory, { soft: true });
  const ids = useMemo(() => mismatchDocs(checks).sort().join(","), [checks]);
  const [history, setHistory] = useState<{ ids: string; byDoc: Map<string, HistoryEntry[]> } | null>(null);
  useEffect(() => {
    if (!ids) return;
    let live = true;
    loadHistoryBatch(ids.split(",")).then((byDoc) => {
      if (live) setHistory({ ids, byDoc });
    });
    return () => {
      live = false;
    };
  }, [ids]);
  return useMemo(() => {
    if (!history || history.ids !== ids || !pau) return checks;
    const today = new Date().toISOString().slice(0, 10);
    return withPending(checks, history.byDoc, { executives: votes?.executives ?? [], pau, snaps, prime: snaps[0]?.primeName ?? null, today });
  }, [checks, history, ids, votes, pau, snaps]);
}
