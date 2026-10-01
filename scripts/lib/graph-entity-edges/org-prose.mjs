// 2w. Org-to-org prose relations. Two conservative sentence shapes, shared with
// graph-entities.mjs Phase 1p (see graph-patterns.mjs):
//   "Rubicon is the Prime Foundation associated with Obex."  → prime_foundation_of
//   "Phoenix Labs is a development company that provides services to the
//    Spark Foundation"                                       → provides_services_to
// An edge is emitted only when BOTH endpoints resolve to existing entities;
// unresolved matches are logged, never guessed. Recall is deliberately low.
import { PRIME_FOUNDATION_RE, PROVIDES_SERVICES_RE, cleanOrgProseName } from "../graph-patterns.mjs";
import { warnDriftCount } from "../graph-tripwires.mjs";

const SHAPES = [
  [PRIME_FOUNDATION_RE, "prime_foundation_of"],
  [PROVIDES_SERVICES_RE, "provides_services_to"],
];

/** Returns true when an edge was emitted (or already existed), false when unresolved. */
function emitMatch(ctx, d, m, edgeType, seen) {
  const fromName = cleanOrgProseName(m[1]);
  const toName = cleanOrgProseName(m[2]);
  const from = ctx.entityByName(fromName);
  const to = ctx.entityByName(toName);
  if (!from || !to || from.id === to.id) {
    console.warn(`  org-prose: unresolved ${edgeType} "${fromName}" → "${toName}" (${d.doc_no})`);
    return false;
  }
  const key = `${edgeType}:${from.id}:${to.id}`;
  if (seen.has(key)) return true;
  seen.add(key);
  ctx.addEdge(from.id, "entity", to.id, "entity", edgeType, [d.doc_no]);
  return true;
}

function run(ctx) {
  const seen = new Set();
  let skipped = 0;
  for (const d of ctx.allDocs) {
    const content = d.content ?? "";
    for (const [re, edgeType] of SHAPES) {
      re.lastIndex = 0;
      for (const m of content.matchAll(re)) if (!emitMatch(ctx, d, m, edgeType, seen)) skipped++;
    }
  }
  console.log(`  org-prose: ${seen.size} edges (${skipped} unresolved matches skipped)`);
  warnDriftCount("org-prose unresolved", skipped);
}

export const pattern = { id: "2w", run };
