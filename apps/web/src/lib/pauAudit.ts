import { buildPauAudit, docsToDate, type AuditInput, type AuditRow, type PrimeChecks } from "@/lib/pauAuditIndex";
import { checkAtlasValues } from "@/lib/pauAtlasValues";
import { graphPrimeSources } from "@/lib/pauDocSources";
import type { LimitDocs } from "@/lib/pauLimitDocs";
import { loadHistoryBatch } from "@/lib/history";
import type { GraphData } from "@/lib/graphData";
import { loadAtlas } from "./docs";
import { loadGraph } from "./graph";
import { loadPau, snapshotsForPrime, type PauResponse } from "./pau";
import { loadPauSteps } from "./pauSteps";
import { withSteps } from "@/lib/pauPending";

export * from "@/lib/pauAudit";
export * from "@/lib/pauAuditIndex";
export * from "@/lib/pauAuditCsv";

/** Every prime's checked values: each Prime Agent the graph lists, with the values its documents state, against its own snapshots, as its PAUs page checks them. */
function primeChecks(graph: GraphData, docs: LimitDocs, res: PauResponse): PrimeChecks[] {
  return graph.participants
    .filter((p) => p.st === "prime")
    .flatMap((p) => {
      const sources = graphPrimeSources(p.id, graph, docs);
      return sources ? [{ primeId: p.id, prime: p.name, checks: checkAtlasValues(sources, snapshotsForPrime(res, p.id)) }] : [];
    });
}

type AuditBase = Omit<AuditInput, "history">;

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

/** Every prime's checked values, the snapshots and the registry's rejected claims, from the graph, the atlas documents and GET /api/pau; kept once the worker has stored a snapshot. */
const loadBase = once(async () => {
  const [graph, docs, res] = await Promise.all([loadGraph(), loadAtlas(), loadPau()]);
  const base: AuditBase = { primes: primeChecks(graph, docs, res), snaps: res.deployments, claims: res.rejectedClaims ?? [] };
  return { value: base, keep: base.snaps.length > 0 };
});

/**
 * The PAU values audit rows (pauAuditIndex.ts), built once per page load from
 * the graph, GET /api/pau, the on-chain steps the server works out (GET
 * /api/pau/steps) and the history of every document stating a disagreement or
 * a limit never set. A failed history read leaves those disagreements undated
 * (ambiguous), never guessed, and failed steps leave the on-chain step unknown;
 * either, or no snapshots yet, is asked again next time.
 */
export const loadPauAudit = once(async () => {
  const stepsLoad = loadPauSteps();
  const base = await loadBase();
  const [history, steps] = await Promise.all([loadHistoryBatch(docsToDate(base.primes)), stepsLoad]);
  const primes = steps ? base.primes.map((p) => ({ ...p, checks: withSteps(p.checks, steps) })) : base.primes;
  return { value: buildPauAudit({ ...base, primes, history }), keep: base.snaps.length > 0 && !!steps };
});

/**
 * The same items without the document histories or the steps, for counting
 * them: whether a value needs an audit never depends on either, only which
 * group it falls in does, so these rows' groups are not to be shown.
 */
export async function loadPauAuditItems(): Promise<AuditRow[]> {
  return buildPauAudit({ ...(await loadBase()), history: new Map() });
}
