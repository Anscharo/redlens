// A stratified document sample for eval-retrieval.ts (--sample-scope, --sample-agent):
// a fixed share of each top-level scope and of each agent artifact, picked by
// sha256 of the UUID so every run and every model gets the same documents.
import { createHash } from "node:crypto";
import type { AtlasNode } from "../../src/types.ts";
import type { EmbedUnit } from "../../src/server/retrieval/embed-units.ts";
import { competingSets } from "./eval-briefing-coverage.ts";
import type { RetrievalQuery } from "./eval-retrieval-queries.ts";

// fragile: doc_no prefix. The agent artifacts sit under one directory of the
// Agent scope; an eval stratum can live with a renumbering, it only moves the sample.
const AGENT_RE = /^A\.6\.1\.1\.(\d+)(?:\.|$)/;

function stratumOf(d: AtlasNode): { key: string; agent: boolean } {
  const agent = AGENT_RE.exec(d.doc_no);
  if (agent) return { key: `agent ${agent[1]}`, agent: true };
  // Needed Research numbers (NR-1, NR-2, …) form one stratum; everything else
  // goes by its top-level scope.
  const scope = d.doc_no.startsWith("NR-") ? "NR" : d.doc_no.split(".").slice(0, 2).join(".");
  return { key: `scope ${scope}`, agent: false };
}

const rank = (id: string) => createHash("sha256").update(id).digest("hex");

/** ceil(rate × n) documents of each stratum, lowest UUID hash first. */
export function sampleDocs(docs: AtlasNode[], scopeRate: number, agentRate: number): Set<string> {
  const strata = new Map<string, { agent: boolean; ids: string[] }>();
  for (const d of docs) {
    const { key, agent } = stratumOf(d);
    const s = strata.get(key) ?? { agent, ids: [] };
    s.ids.push(d.id);
    strata.set(key, s);
  }
  const out = new Set<string>();
  const report: string[] = [];
  for (const [key, s] of [...strata].sort(([a], [b]) => a.localeCompare(b))) {
    const take = Math.ceil((s.agent ? agentRate : scopeRate) * s.ids.length);
    for (const id of s.ids.sort((a, b) => rank(a).localeCompare(rank(b))).slice(0, take)) out.add(id);
    report.push(`${key} ${take}/${s.ids.length}`);
  }
  console.log(`sample: ${out.size}/${docs.length} documents (${report.join(", ")})`);
  return out;
}

/**
 * The pool under a sample: every unit that holds a sampled document or a
 * document some query competes over, whole. All queries score, the sample adds
 * the distractors, and the hard near-sibling sets stay in.
 */
export function samplePool(docs: AtlasNode[], units: EmbedUnit[], queries: RetrievalQuery[], sample: ReadonlySet<string>) {
  const keep = new Set(sample);
  for (const set of competingSets(docs, units, queries).values()) for (const id of set) keep.add(id);
  const poolUnits = units.filter((u) => keep.has(u.anchorId) || u.memberIds.some((id) => keep.has(id)));
  const poolDocs = new Set(poolUnits.flatMap((u) => [u.anchorId, ...u.memberIds]));
  console.log(`  sample pool: ${poolUnits.length}/${units.length} units, ${poolDocs.size} documents, all ${queries.length} queries scored`);
  return { poolUnits, scoredQueries: queries };
}
