import { buildPauAudit, docsToDate, type AuditInput, type AuditRow, type PrimeChecks } from "@/lib/pauAuditIndex";
import { lastContentChange } from "@/lib/pauAudit";
import { checkAtlasValues } from "@/lib/pauAtlasValues";
import { primeValueSources } from "@/lib/pauDocSources";
import { loadHistoryBatch } from "@/lib/history";
import type { GraphData } from "@/lib/graphData";
import { loadGraph } from "./graph";
import { loadPau, snapshotsForPrime, type PauResponse } from "./pau";

export * from "@/lib/pauAudit";
export * from "@/lib/pauAuditIndex";
export * from "@/lib/pauAuditCsv";

/** Every prime's checked values: each Prime Agent the graph lists, against its own snapshots. */
function primeChecks(graph: GraphData, res: PauResponse): PrimeChecks[] {
  return graph.participants
    .filter((p) => p.st === "prime")
    .flatMap((p) => {
      const sources = primeValueSources(p.id, graph);
      return sources ? [{ primeId: p.id, prime: p.name, checks: checkAtlasValues(sources, snapshotsForPrime(res, p.id)) }] : [];
    });
}

type AuditBase = Omit<AuditInput, "atlasChanged">;

/** Caches a load once it succeeds and says to keep it; a failure, or a load that says not to, is asked again next time. */
function once<T>(load: () => Promise<{ value: T; keep: boolean }>): () => Promise<T> {
  let cached: Promise<T> | null = null;
  return () => {
    if (!cached) {
      cached = load().then(({ value, keep }) => {
        if (!keep) cached = null;
        return value;
      });
      cached.catch(() => {
        cached = null;
      });
    }
    return cached;
  };
}

/** Every prime's checked values, the snapshots and the registry's rejected claims, from the graph and GET /api/pau; kept once the worker has stored a snapshot. */
const loadBase = once(async () => {
  const [graph, res] = await Promise.all([loadGraph(), loadPau()]);
  const base: AuditBase = { primes: primeChecks(graph, res), snaps: res.deployments, claims: res.rejectedClaims ?? [] };
  return { value: base, keep: base.snaps.length > 0 };
});

/**
 * The PAU values audit rows (pauAuditIndex.ts), built once per page load from
 * the graph, GET /api/pau and the history of every document stating a
 * disagreement. A failed history read leaves those disagreements undated
 * (ambiguous), never guessed; no snapshots yet is asked again.
 */
export const loadPauAudit = once(async () => {
  const base = await loadBase();
  const history = await loadHistoryBatch(docsToDate(base.primes));
  const atlasChanged = new Map([...history].flatMap(([id, entries]) => {
    const day = lastContentChange(entries);
    return day ? [[id, day] as const] : [];
  }));
  return { value: buildPauAudit({ ...base, atlasChanged }), keep: base.snaps.length > 0 };
});

/**
 * The same items without the document histories, for counting them: whether a
 * value needs an audit never depends on the dates, only which group it falls
 * in does, so these rows' groups are not to be shown.
 */
export async function loadPauAuditItems(): Promise<AuditRow[]> {
  return buildPauAudit({ ...(await loadBase()), atlasChanged: new Map() });
}
