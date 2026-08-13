/**
 * Process keyword classifier.
 *
 * Candidate generator for the curated processes list (public/processes.json).
 * Returns docs whose titles contain one of the process-shaped keyword families.
 *
 * Used by:
 *   - scripts/required/check-processes-dirty.mjs (atlas-update dirty check)
 *   - scripts/aux/processes-bootstrap.mjs (initial seed)
 *
 * Recall is ~85%: authors consistently use "Process Definition" / "Cycle" /
 * "Workflow" in titles, but generic containers ("Implementation", "Stages")
 * will be missed and must be added to public/processes.json by hand.
 */

// Word-boundary matches on the title, case-insensitive.
//
// Excluded — too noisy (each tested against the current atlas; novel-hit
// counts in parens are non-curated matches that would flood the audit):
//   "protocol" (Protocol Scope, Protocol Security Workstream Lead, …)
//   "mint" (24) / "burn" (20) — token operation primitives, mostly config
//   "routine" (116) — generic ("Routine Maintenance" everywhere)
//   "cadence" (14) — schema-instantiated sub-cells, not the process itself
//   "emergency response" (29) — broad phrase, mostly sub-docs under the
//     already-curated Emergency Response System
export const PROCESS_KEYWORDS = [
  "process",
  "cycle",
  "workflow",
  "procedure",
  "lifecycle",
  "onboarding",
  "offboarding",
  "ratification",
  "reconciliation",
  // Structural / sequence vocabulary
  "stages",
  "steps",
  "sequence",
  // Recurring-action / handoff vocabulary
  "rotation",
  "handover",
  "escalation",
  // Domain-specific procedural words
  "adjudication",
  "issuance",
  "redemption",
  "renewal",
  "termination",
  // Multi-word — checked as substring (no \b around them)
  "review period",
];

// Atlas doc types that are never processes — used to filter classifier hits.
// Processes are almost always Section or Core; the rest are content fragments.
export const NON_PROCESS_TYPES = new Set([
  "Annotation",
  "Action Tenet",
  "Scenario",
  "Scenario Variation",
  "Active Data",
  "Needed Research",
  "Type Specification",
  "Active Data Controller",
  "Scope",
  "Article",
]);

// Exact-title matches that are schema sub-sections WITHIN a process definition,
// not standalone processes. These appear ~20 times each under every primitive's
// Process Definition Schema (A.2.2.2.*). Filtered to keep the audit signal high.
export const NEVER_PROCESS_TITLES = new Set([
  "Process",
  "Process Flow",
  "Process Definition",
  "Process Initiation Logic",
  "Cycle Breakdown",
  "Full Cycle Breakdown",
  "Cycle Overview",
  "Deployment",
  // Schema-instantiated sub-sections that repeat per entity / per primitive.
  // Tracking each instance separately would balloon the inventory; if a
  // specific one matters, add the UUID to public/processes.json by hand.
  "Operational Process Definition",
  "Instance Lifecycle Management",
  "Process Definition For Upkeep Fee Payment",
  "Root Edit Voting Process In Emergency Situations",
  "Root Edit Voting Process in Emergency Situations",
  "Root Edit Voting Process in Urgent and Emergency Situations",
]);

const SINGLE_WORD = PROCESS_KEYWORDS.filter((k) => !k.includes(" "));
const MULTI_WORD = PROCESS_KEYWORDS.filter((k) => k.includes(" "));

const SINGLE_RE = new RegExp(`\\b(${SINGLE_WORD.join("|")})\\b`, "i");

/**
 * @param {string} title
 * @returns {string[]} matched keywords (empty if none)
 */
export function matchKeywords(title) {
  if (!title) return [];
  const hits = new Set();
  const lower = title.toLowerCase();

  const m = title.match(SINGLE_RE);
  if (m) hits.add(m[1].toLowerCase());

  for (const kw of MULTI_WORD) {
    if (lower.includes(kw)) hits.add(kw);
  }

  return [...hits];
}

/**
 * Walks the parentId chain to determine if `id` is a descendant of any uuid in
 * `ancestorSet`. Returns the ancestor uuid that matches, or null.
 */
function findAncestor(id, docs, ancestorSet) {
  let cur = docs[id]?.parentId;
  let guard = 0;
  while (cur && guard++ < 50) {
    if (ancestorSet.has(cur)) return cur;
    cur = docs[cur]?.parentId;
  }
  return null;
}

/**
 * @param {Record<string, {title: string, type?: string, parentId?: string}>} docs
 * @param {Iterable<string>} [excludeAncestors] uuids whose descendants should be skipped
 * @returns {Array<{id: string, title: string, keywords: string[]}>}
 */
export function findCandidates(docs, excludeAncestors = []) {
  const excludeSet = new Set(excludeAncestors);
  const out = [];
  for (const [id, node] of Object.entries(docs)) {
    if (NON_PROCESS_TYPES.has(node.type)) continue;
    if (NEVER_PROCESS_TITLES.has(node.title?.trim())) continue;
    const keywords = matchKeywords(node.title);
    if (keywords.length === 0) continue;
    if (excludeSet.size > 0 && findAncestor(id, docs, excludeSet)) continue;
    out.push({ id, title: node.title, keywords });
  }
  return out;
}
