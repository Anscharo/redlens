import { useEffect, useMemo, useState } from "react";
import type { HistoryEntry } from "@/lib/history";
import { loadHistoryBatch } from "@/lib/history";
import type { StoredPauSnapshot } from "@/lib/pau";
import type { ValueCheck } from "@/lib/pauAtlasValues";
import { datedDocs, withOnchain } from "@/lib/pauPending";
import { loadPauHistory } from "../lib/pau";
import { loadVoteIndex } from "../lib/votes";
import { loadOpenAtlasPrs } from "../lib/openAtlasPrs";
import { useLoaded } from "./useAtlasData";

/**
 * The checks with each mismatch or limit never set carrying what governance
 * did about it (`onchain`, src/lib/pauPending.ts): the spell the pull request
 * that wrote the value names, followed through the vote record and the PAU
 * change history, and the open atlas pull requests for a change the chain made
 * first. Reads the document history of only those documents; until
 * it and the PAU history land, and without a backend, the checks come back as
 * they are, so a mismatch is never hidden by a failed read.
 */
export function useOnchainSteps(checks: ValueCheck[], snaps: readonly StoredPauSnapshot[]): ValueCheck[] {
  const votes = useLoaded(loadVoteIndex, { soft: true });
  const pau = useLoaded(loadPauHistory, { soft: true });
  const openPrs = useLoaded(loadOpenAtlasPrs, { soft: true });
  const ids = useMemo(() => datedDocs(checks).sort().join(","), [checks]);
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
    return withOnchain(checks, history.byDoc, { executives: votes?.executives ?? [], pau, snaps, today, openPrs: openPrs ?? [] });
  }, [checks, history, ids, votes, pau, snaps, openPrs]);
}
