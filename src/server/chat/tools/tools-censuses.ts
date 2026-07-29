// atlas_describe "censuses" section — the deterministic concept censuses
// (src/lib/conceptsCensus.ts, the /reports/anatomy Concepts tab) exposed to
// the chat loop. Summary rows by default; full member lists via a
// "censuses:<slug>" section spec — the drill-down path the concepts prefetch
// lane (src/server/concepts-prefetch.ts) points the model at. Only the
// censused tier is exposed: everything here is mechanical compute over the
// corpus, so it is safe to state as a finding; the catalog's interpretive
// prose is deliberately NOT served through this path.
import type { Indexes } from "../../retrieval/indexes.ts";
import { fitToBudget, TRUNCATION_HINT } from "../output-budget.ts";
import {
  computeConceptsCensus,
  CENSUS_SLUGS,
  type CensusResult,
  type CensusSlug,
} from "../../../lib/conceptsCensus.ts";

// Memoized per Indexes instance — the updater swaps in a fresh Indexes on
// atlas drift, which naturally invalidates this (the statsSection pattern).
const cache = new WeakMap<Indexes, Record<CensusSlug, CensusResult>>();

export function conceptsCensusFor(ix: Indexes): Record<CensusSlug, CensusResult> {
  let hit = cache.get(ix);
  if (!hit) {
    hit = computeConceptsCensus(Object.fromEntries(ix.docMap));
    cache.set(ix, hit);
  }
  return hit;
}

export interface CensusSummaryRow {
  slug: CensusSlug;
  title: string;
  signature: CensusResult["signature"];
  counts: Record<string, number>;
  notes?: string;
}

export function censusSummary(r: CensusResult): CensusSummaryRow {
  return {
    slug: r.slug as CensusSlug,
    title: r.title,
    signature: r.signature,
    counts: r.counts,
    ...(r.notes ? { notes: r.notes } : {}),
  };
}

const NOTE =
  "Deterministic censuses computed by our analysis pipeline over the atlas corpus — cross-cutting findings " +
  "(empty registries, unused doc types, duplicated titles…) that no single atlas document states. " +
  "These numbers are our findings, NOT atlas text: when answering from them, attribute explicitly " +
  "('our census shows…', 'our analysis finds…') — never present them as something the atlas itself says. " +
  'Full member lists: call atlas_describe with sections:["censuses:<slug>"].';

export function censusesSection(ix: Indexes, slugs: string[]): Record<string, unknown> {
  const all = conceptsCensusFor(ix);
  if (slugs.length === 0) return { note: NOTE, censuses: CENSUS_SLUGS.map((s) => censusSummary(all[s])) };

  const censuses = slugs.map((s) => {
    const r = (all as Record<string, CensusResult>)[s];
    if (!r) return { slug: s, error: `Unknown census slug. Known: ${CENSUS_SLUGS.join(", ")}` };
    const { kept, truncated } = fitToBudget(r.members);
    return { ...censusSummary(r), members: kept, ...(truncated ? { truncated: true, hint: TRUNCATION_HINT } : {}) };
  });
  return { note: NOTE, censuses };
}
