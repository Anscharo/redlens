import { useMemo } from "react";
import { checkAtlasValues, type ValueCheck } from "@/lib/pauAtlasValues";
import type { StoredPauSnapshot } from "@/lib/pau";
import { graphPrimeSources } from "@/lib/pauDocSources";
import { loadGraph } from "../lib/graph";
import { loadAtlas } from "../lib/docs";
import { loadPau, snapshotsForPrime } from "../lib/pau";
import { useLoaded } from "./useAtlasData";
import { usePendingChecks } from "./usePendingChecks";
import { checkAtlasAddresses } from "@/lib/pauAddressChecks";
import { checkAgentInstances } from "@/lib/agentChecks";
import { checkGuardParams } from "@/lib/paramGuardChecks";
import { checkVaultRoles } from "@/lib/vaultRoleChecks";
import { loadChainState } from "../lib/chainstate";
import { indexParamChecks } from "../lib/paramChecks";
import { heldKeyId, type CardMarks } from "../lib/rowMark";
import type { LiveRateLimit } from "@/lib/pau";

/** Every value the atlas states for the prime's keys, in its instances and in its limit documents, beside the chain (pauAtlasValues.ts), a mismatch still waiting on a spell marked pending; empty until the graph loads. */
export function usePrimeAtlasChecks(primeId: string | undefined, snaps: StoredPauSnapshot[]): ValueCheck[] {
  const graph = useLoaded(loadGraph, { soft: true });
  const atlas = useLoaded(loadAtlas, { soft: true });
  const checks = useMemo(() => {
    const sources = primeId ? graphPrimeSources(primeId, graph, atlas ?? undefined) : null;
    return sources ? checkAtlasValues(sources, snaps) : [];
  }, [graph, atlas, primeId, snaps]);
  return usePendingChecks(checks, snaps[0]?.primeName ?? null);
}

/** Every key the snapshots hold, by chain and key. */
function heldKeys(snaps: StoredPauSnapshot[]): Map<string, LiveRateLimit[]> {
  const out = new Map<string, LiveRateLimit[]>();
  for (const s of snaps) for (const c of s.contracts) for (const r of c.rateLimits ?? []) {
    const id = heldKeyId(s.chain, r.key);
    out.set(id, [...(out.get(id) ?? []), r]);
  }
  return out;
}

/** Every check an instance card shows for the prime: its values against the contract, and its IDs and addresses against the snapshots; null without a prime, and until the snapshots and graph load. */
export function usePrimeCardMarks(primeId: string | undefined): CardMarks | null {
  const res = useLoaded(loadPau, { soft: true });
  const graph = useLoaded(loadGraph, { soft: true });
  const atlas = useLoaded(loadAtlas, { soft: true });
  const chain = useLoaded(loadChainState, { soft: true });
  const snaps = useMemo(() => (res && primeId ? snapshotsForPrime(res, primeId) : []), [res, primeId]);
  const values = usePrimeAtlasChecks(primeId, snaps);
  return useMemo(() => {
    const sources = res && primeId ? graphPrimeSources(primeId, graph, atlas ?? undefined) : null;
    // A failed /api/pau resolves to no deployments at all: say nothing rather than mark every row unindexed.
    if (!res || res.deployments.length === 0 || !primeId || !sources) return null;
    return { values: indexParamChecks(values), addresses: checkAtlasAddresses(sources, snaps), plain: new Map([...checkAgentInstances(sources, snaps, chain?.values ?? null), ...checkGuardParams(sources, snaps), ...checkVaultRoles(sources, snaps)]), held: heldKeys(snaps) };
  }, [res, graph, atlas, chain, primeId, snaps, values]);
}
