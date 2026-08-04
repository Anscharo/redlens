/**
 * Zero-match tripwires + drift-count buckets for the build pipeline.
 *
 * The structural gates in graph-patterns.mjs are doc_no regexes, and the
 * pipeline's type filters key on exact type names. Both fail SILENTLY when
 * the atlas renumbers or renames: `.filter()` over zero matches is not an
 * error, so entire entity families (agents, accords, ICDs) just vanish from
 * the graph along with every report built on them. Each tripwire warns on
 * stderr with the `[drift]` prefix so atlas-update.yml's warnings diff — and
 * the weekly atlas-healer — sees the collapse the build itself won't notice.
 *
 * countBucket/warnDriftCount serve the second silent channel: "N unresolved"
 * counters previously went to stdout, which the warnings capture never reads.
 * Emitting the BUCKET (not the raw count) on stderr keeps the line stable
 * across ±1 churn, so the baseline diff fires only when a counter jumps a
 * magnitude — the regression signal, not the noise.
 */

import {
  isPrimeAgent,
  isExecutorAgent,
  isFacilitatorDoc,
  isGovOpsDoc,
  isActiveData,
  isEcosystemAccord,
  isPartyDetails,
  isGrantDoc,
  isICD,
} from "./graph-patterns.mjs";

// gate name → [predicate, what empties out when it matches nothing]
const DOC_GATES = [
  ["isPrimeAgent", isPrimeAgent, "prime-agent entities, Radar, rewards, active-data agent columns"],
  ["isExecutorAgent", isExecutorAgent, "executor-agent entities and role edges"],
  ["isFacilitatorDoc", isFacilitatorDoc, "facilitator orgs and facilitator_for edges"],
  ["isGovOpsDoc", isGovOpsDoc, "govops orgs and govops_for edges"],
  ["isActiveData", isActiveData, "active_data_for edges and the Active Data report's controller join"],
  ["isEcosystemAccord", isEcosystemAccord, "ecosystem-accord entities and composite parties"],
  ["isPartyDetails", isPartyDetails, "accord party-details docs"],
  ["isGrantDoc", isGrantDoc, "grant authorization transfers"],
  ["isICD", isICD, "instances, invocations, and every ICD-derived param"],
];

// Exact type names the pipeline filters on. A type RENAME warns once as
// "unknown document type <new>" in atlas-parser — this pairs that with the
// consumer-side collapse the rename causes.
const TYPE_GATES = [
  ["Active Data Controller", "responsible_party_for edges and the Active Data report"],
  ["Active Data", "Active Data table extraction and its drift detector"],
  ["Core", "glossary terms, process-step detection, and most content extraction"],
  ["Scope", "the crossview scope tree"],
];

/**
 * Warn for every structural gate that matches zero docs. Call once from
 * build-graph after docs.json is loaded. Returns the number of tripwires
 * fired (0 in a healthy build).
 */
export function checkGateTripwires(allDocs) {
  let fired = 0;
  for (const [name, predicate, consequence] of DOC_GATES) {
    if (allDocs.some(predicate)) continue;
    console.warn(
      `  [drift] tripwire: ${name} matched 0 docs — ${consequence} will be empty ` +
        `(doc_no gate in scripts/lib/graph-patterns.mjs likely broken by an atlas renumber)`,
    );
    fired++;
  }
  const typeCounts = new Map();
  for (const d of allDocs) typeCounts.set(d.type, (typeCounts.get(d.type) ?? 0) + 1);
  for (const [type, consequence] of TYPE_GATES) {
    if (typeCounts.get(type)) continue;
    console.warn(
      `  [drift] tripwire: no docs of type "${type}" — ${consequence} will be empty ` +
        `(atlas doc type likely renamed; check atlas-parser's unknown-type warning for the successor)`,
    );
    fired++;
  }
  return fired;
}

export function countBucket(n) {
  if (n === 0) return "0";
  if (n < 10) return "1-9";
  if (n < 50) return "10-49";
  return "50+";
}

/** Stable stderr line for an unresolved-counter bucket (see module docs). */
export function warnDriftCount(label, n) {
  console.warn(`  [drift-count] ${label}: ${countBucket(n)}`);
}
