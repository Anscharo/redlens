// Liveness map: flags non-settled docs (empty structural scaffolding, or a
// doc whose own content signals not-yet-specified) so chat retrieval and the
// answer verifier can avoid overclaiming from a stub. See docs/research/
// synlang-wiki.md §3.2. Docs NOT in the map are settled — the default, kept
// implicit so the map stays small (a few hundred of ~11k docs).
//
// scaffold reuses conceptsCensus.ts's registry-liveness / empty-scaffolding
// censuses (read-only import — don't re-derive their heuristics here, see
// CLAUDE.md "graph over heuristics" / don't duplicate deterministic logic).
// placeholder is content-pattern-driven and lives entirely in this module.

import type { AtlasNode } from "../types";
import { censusEmptyScaffolding, censusRegistryLiveness } from "./conceptsCensus";
import { KV_LINE_RE, parseValue } from "./paramValue";

export type Liveness = "scaffold" | "placeholder";

// Stub phrases naming an explicit future-tense deferral of THIS doc's own
// content. "(future|later) iteration" generalizes across "the Atlas" and
// named Artifacts/Frameworks ("the Spark Artifact", "the Risk Framework") —
// verified against the live corpus: 300 hits, every one of the form "X will
// be specified/defined/developed/removed ... in a future iteration of Y".
// Dropped from the spec's candidate list after corpus testing found zero
// true positives: "placeholder" (17 hits — all either an editorial process
// describing how templates get filled in, or `[Instance_..._Placeholder]`
// ICD template-variable syntax, a different concept from atlas content being
// unspecified) and "to be added" (2 hits — both about tokens/instructions
// being added to a *target*, unrelated to this doc's own content).
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /(future|later) iteration/i,
  /to be defined/i,
  /to be determined/i,
  /not yet specified/i,
  /not yet defined/i,
];
// TBD as a literal placeholder value (backtick-wrapped, sole content, or "is
// specified in TBD") vs. quoted as an example of a marking convention ("will
// mark any items as \"TBD\" or \"TBC\"") — the corpus's one false positive
// among 12 hits is exactly the quoted case, excluded by the lookaround.
const TBD_RE = /(?<!")\bTBD\b(?!")/;

// Doc-level gate against clause-level false positives: a real, settled doc
// that specifies a whole rule and defers only one sub-detail ("Core Council
// Allocation", "Final Calculation By Core GovOps", the "Routine Protocol"
// family) still contains a stub phrase but is not itself a placeholder —
// most of its content is settled. Require the non-matching-sentence
// remainder to be thin. Corpus-tuned against the "future iteration" cohort:
// 248 chars was the lowest remainder among confirmed clause-level false
// positives ("Process Timing and Schedule" — a real settled monthly-timing
// rule with one deferred detail); 200 excludes it with margin while keeping
// every doc sampled below that line, including short parameter-table stubs
// whose only text is a one-line pointer plus the deferred fields themselves.
const REMAINDER_GATE = 200;

// Line-then-sentence split, not a flat paragraph/sentence split: two distinct
// confirmed false positives needed ruling out. (1) Several docs (the 8
// single-paragraph "Additional operational details ... will be specified in
// a future iteration" docs in A.3.2.2.4.3.*) pack a real rule and the
// deferral clause into the same paragraph — plain paragraph-level splitting
// zeroes the remainder and wrongly passes the gate. (2) A structured
// bulleted doc ("Sky Core Atlas Updates", A.2.2.9.1.2.4.1.3.4.1) has one
// fully-specified branch (real field values) and a sibling branch that's
// just "- TBD" — flattening newlines before sentence-splitting merges the
// whole bullet tree into a single "sentence" containing TBD, again zeroing
// the remainder. Splitting on lines first keeps each bullet its own unit.
function splitUnits(content: string): string[] {
  const units: string[] = [];
  for (const line of content.split(/\n+/)) {
    const cleaned = line.trim().replace(/^[-*]\s+/, "");
    if (!cleaned) continue;
    units.push(...cleaned.split(/(?<=[.!?])\s+(?=[A-Z`[])/));
  }
  return units;
}

// A stated VALUE outside every stub sentence settles the doc no matter how thin
// the rest of it is — the length gate alone can't see the difference between
// "one short pointer plus deferred fields" (a real placeholder) and "one short
// SPECIFIED value plus a deferred sub-detail" (not one). Three real corpus docs
// sit on the wrong side of it: "Maple" (A.3.2.2.1.1.1.1.3.1 — "The Instance
// Financial CRR for Maple SyrupUSDC is 3%." + a deferred maximum-exposure
// clause) and two "Inflow Rate Limits" docs (a specified `maxAmount`: 0 + a
// deferred `slope`). Tagging those placeholder is what would let the absence
// contract (verify/absence.ts groundedSignal) mark "the atlas doesn't specify
// Maple's CRR" as GROUNDED — precisely the false-absence hole this whole
// mechanism exists to close. The three shapes below are paramExtract.ts's own
// notion of a stated value (kv line with a parseable RHS, backticked numeric,
// bare percentage); measured against the corpus, they flip exactly those 3
// docs out of the 266 placeholder tags and nothing else.
const BACKTICK_NUM_RE = /`\d[\d,]*(?:\.\d+)?%?`/;
const BARE_PERCENT_RE = /\b\d[\d,]*(?:\.\d+)?\s*%/;

function statesAValue(unit: string): boolean {
  const kv = KV_LINE_RE.exec(unit);
  if (kv && parseValue(kv[2].trim())) return true;
  return BACKTICK_NUM_RE.test(unit) || BARE_PERCENT_RE.test(unit);
}

// One pass over the non-stub units: how much text they carry, and whether any
// of them states a value.
function scanNonStubUnits(content: string): { remainder: number; statesValue: boolean } {
  let remainder = 0;
  let statesValue = false;
  for (const u of splitUnits(content)) {
    if (TBD_RE.test(u) || PLACEHOLDER_PATTERNS.some((re) => re.test(u))) continue;
    remainder += u.length;
    statesValue ||= statesAValue(u);
  }
  return { remainder, statesValue };
}

function hasPlaceholderContent(content: string): boolean {
  if (!TBD_RE.test(content) && !PLACEHOLDER_PATTERNS.some((re) => re.test(content))) return false;
  const { remainder, statesValue } = scanNonStubUnits(content);
  return !statesValue && remainder <= REMAINDER_GATE;
}

// Childless-empty-stub descendant check — doc_no prefix, the same structural
// (not identity) use conceptsCensus.ts's own hasDescendant makes; sorted
// binary search keeps the whole-corpus pass O(n log n).
// fragile: doc_no prefix — this asks "does ANY doc sit under this one", never
// "is this specific doc X", so a renumbering moves the whole family together
// and the answer is unchanged. Migrating it to parentId would need a
// child-count index the census path doesn't build.
function buildHasDescendant(docNos: string[]): (doc_no: string) => boolean {
  const sorted = [...docNos].sort();
  return (doc_no: string) => {
    const prefix = `${doc_no}.`;
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sorted[mid] < prefix) lo = mid + 1;
      else hi = mid;
    }
    return lo < sorted.length && sorted[lo].startsWith(prefix);
  };
}

export function buildLivenessMap(docMap: Map<string, AtlasNode>): Map<string, Liveness> {
  // Only the two censuses this map consumes — computeConceptsCensus would run
  // all ten, and this rebuilds on every boot, dev preflight, and sha-drift
  // hot-swap.
  const all = [...docMap.values()];

  const liveness = new Map<string, Liveness>();
  for (const m of [...censusRegistryLiveness(all).members, ...censusEmptyScaffolding(all).members]) {
    if (m.bucket === "empty") liveness.set(m.uuid, "scaffold");
  }

  const hasDescendant = buildHasDescendant([...docMap.values()].map((n) => n.doc_no));
  for (const node of docMap.values()) {
    if (liveness.has(node.id)) continue; // scaffold wins over placeholder
    const childlessEmptyStub = node.content.trim().length === 0 && !hasDescendant(node.doc_no);
    if (childlessEmptyStub || hasPlaceholderContent(node.content)) {
      liveness.set(node.id, "placeholder");
    }
  }

  return liveness;
}
