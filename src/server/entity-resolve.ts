// Server-side entity resolution: map free text ("Spark Protocol", "spark",
// "grove foundation") to atlas entities, so callers don't need to know the exact
// slug. Pure, in-memory over ix.entities. Backs atlas_entities (search) and the
// `entity`/`name` inputs of atlas_entity / atlas_query / atlas_entity_params.
import type { Indexes, Entity } from "./indexes.ts";

// Only true filler — never domain words like "foundation"/"agent"/"party",
// which are load-bearing parts of real slugs (spark-foundation, grove-party).
const STOP = new Set(["the", "a", "an", "of", "and", "for", "to", "s"]);

function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => !STOP.has(t));
}

// Score one entity against the query token set. Rewards matched entity tokens,
// penalizes entity tokens the query DIDN'T mention, and ignores extra query
// tokens (so "spark protocol" still nails "spark"). Exact slug/name wins big.
function scoreEntity(q: Set<string>, qSlug: string, qRaw: string, e: Entity): number {
  let best = 0;
  for (const cand of [e.slug, e.name]) {
    if (!cand) continue;
    const s = tokens(cand);
    if (s.length === 0) continue;
    let inter = 0;
    for (const t of s) if (q.has(t)) inter++;
    if (inter === 0) continue;
    let sc = inter * 2 - (s.length - inter);
    const entityInQuery = s.every((t) => q.has(t)); // entity ⊆ query
    if (entityInQuery) sc += 1;
    if (entityInQuery && s.length === q.size) sc += 3; // exact token-set match
    best = Math.max(best, sc);
  }
  if (e.slug.toLowerCase() === qSlug || e.slug.toLowerCase() === qRaw || e.name.toLowerCase() === qRaw) best += 100;
  return best;
}

export function matchEntities(ix: Indexes, text: string, limit = 10): { entity: Entity; score: number }[] {
  const q = new Set(tokens(text));
  if (q.size === 0) return [];
  const qRaw = text.toLowerCase().trim();
  const qSlug = qRaw.replace(/\s+/g, "-");
  const scored: { entity: Entity; score: number }[] = [];
  for (const e of ix.entities) {
    const score = scoreEntity(q, qSlug, qRaw, e);
    if (score > 0) scored.push({ entity: e, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (b.entity.is_active ? 1 : 0) - (a.entity.is_active ? 1 : 0) ||
      a.entity.slug.length - b.entity.slug.length ||
      a.entity.slug.localeCompare(b.entity.slug),
  );
  return scored.slice(0, limit);
}

// Best single match, or null when nothing overlaps. Exact slug lookups still
// short-circuit to the exact entity (via the +100 bonus in scoreEntity).
export function resolveEntity(ix: Indexes, text: string): Entity | null {
  return matchEntities(ix, text, 1)[0]?.entity ?? null;
}
