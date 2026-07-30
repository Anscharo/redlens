// Concepts lane for the deterministic prefetch (prefetch.ts): match the
// user's message against high-precision keyword signatures for the concept
// censuses (src/lib/conceptsCensus.ts) and inject compact summary rows —
// counts + detection signature, never member lists — so cross-cutting
// questions ("how many registries are empty?", "which document types are
// unused?") reach the model with the census in hand instead of relying on it
// thinking to call a tool. Same philosophy as the glossary/entity lanes: a
// hit is always worth the tokens, a miss injects nothing. Drill-down to
// members goes through atlas_describe sections:["censuses:<slug>"]
// (tools-censuses.ts).
import type { Indexes } from "./retrieval/indexes.ts";
import { conceptsCensusFor, censusSummary, type CensusSummaryRow } from "./chat/tools/tools-censuses.ts";
import type { CensusSlug } from "../lib/conceptsCensus.ts";

// A question phrased across several census vocabularies is usually about the
// catalog itself — three summaries orient without flooding the transcript.
const MAX_CENSUSES = 3;

// Word-boundary signatures, chosen to never fire on ordinary doc-lookup
// phrasing: "list of prime agents" or "what is the stability rate" match no
// lane. Order is the tie-break when a question trips more than MAX_CENSUSES.
const SIGNATURES: [CensusSlug, RegExp][] = [
  ["registry-liveness", /\bregistr(y|ies)\b/i],
  ["ghost-doc-types", /\b(document|doc) types?\b|\bghost\b|\bunused types?\b/i],
  ["cross-scope-duplication", /\bduplicat|\bparallel docs?\b|\bsame title\b|\bcross[- ]scope\b/i],
  ["transitionary-measures", /\btransition(ary|al)\b/i],
  ["formula-docs", /\bformulas?\b|\bequations?\b|\bmathematical\b/i],
  ["prohibition-language", /\bprohibit|\bforbidden\b|\bnot permitted\b|\bdisallow/i],
  ["empty-scaffolding", /\bscaffold|\bstatus bucket|\bempty (director(y|ies)|sections?|shells?)\b/i],
  ["numbered-step-docs", /\bnumbered steps?\b|\bstep[- ]by[- ]step\b/i],
  ["title-templates", /\btitle templates?\b|\btemplated?\b/i],
  ["normative-title-families", /\bnormative\b/i],
];

export function matchConceptCensuses(question: string): CensusSlug[] {
  return SIGNATURES.filter(([, re]) => re.test(question))
    .map(([slug]) => slug)
    .slice(0, MAX_CENSUSES);
}

export interface CensusPrefetchRow extends CensusSummaryRow {
  members_hint: string;
}

export const CENSUSES_NOTE =
  "These censuses are our own analysis findings — deterministic computations over the atlas corpus, not atlas text. " +
  "When answering from them, attribute explicitly ('our census shows…', 'our analysis finds…'); " +
  "never present them as something the atlas itself states.";

export function censusPrefetchRows(ix: Indexes, question: string): CensusPrefetchRow[] {
  const slugs = matchConceptCensuses(question);
  if (slugs.length === 0) return [];
  const all = conceptsCensusFor(ix);
  return slugs.map((slug) => ({
    ...censusSummary(all[slug]),
    members_hint: `For the full member list call atlas_describe with sections:["censuses:${slug}"].`,
  }));
}
