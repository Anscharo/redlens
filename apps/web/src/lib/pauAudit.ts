import { buildPauAudit, docsToDate, type AuditRow, type PrimeChecks } from "@/lib/pauAuditIndex";
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

let cached: Promise<AuditRow[]> | null = null;

/**
 * The PAU values audit rows (pauAuditIndex.ts), built once per page load from
 * the graph, GET /api/pau and the history of every document stating a
 * disagreement. A failed history read leaves those disagreements undated
 * (ambiguous), never guessed; no snapshots yet is no rows, and is asked again.
 */
export function loadPauAudit(): Promise<AuditRow[]> {
  if (!cached) {
    cached = Promise.all([loadGraph(), loadPau()]).then(async ([graph, res]) => {
      const primes = primeChecks(graph, res);
      const history = await loadHistoryBatch(docsToDate(primes));
      const atlasChanged = new Map([...history].flatMap(([id, entries]) => {
        const day = lastContentChange(entries);
        return day ? [[id, day] as const] : [];
      }));
      const rows = buildPauAudit({ primes, snaps: res.deployments, claims: res.rejectedClaims ?? [], atlasChanged });
      if (res.deployments.length === 0) cached = null;
      return rows;
    });
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}
