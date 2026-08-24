// Second trigger lane for the STRONG tier: does this question LOOK like
// whole-corpus enumeration or synthesis, even when it uses none of the words
// model-router.ts's regexes watch for?
//
// The regexes are high-precision and low-recall, and the gap is not small.
// Measured 2026-08-21 against 28 natural paraphrases written to avoid every
// STRONG trigger ("map out the entities the atlas recognizes", "what roles has
// the atlas defined so far"): the regex lane caught **0 of 28**. Its 11-of-14
// score on the bakeoff set is in-sample — those patterns were fitted to those
// questions.
//
// Why the strong tier is worth reaching for at all: the 2026-08-21 bakeoff
// (gpt-5.6-luna vs gemma-4-31b-it, one judge, 14 hard queries) went 6 wins / 0
// losses / 6 ties, and EVERY win was a corpus-wide enumeration or generation.
// The default model's failure mode there is completeness (0.70 vs 0.95) — it
// under-answers rather than inventing. That is the class this lane targets.
//
// The cost asymmetry is what makes a permissive lane safe here, and it is
// unusual: a false fire routes an easy question to a model the same bakeoff
// showed is both BETTER and FASTER (0.942 vs 0.781, 26.6s vs 43.4s), so it
// costs tokens — not quality, not latency. A miss is simply today's behavior,
// and the advisor's recovery cycle escalates a failed turn anyway
// (docs/chat-system.md §6.5). Nothing here can make an answer worse.
// Cost, measured 2026-08-21: 122ms on the FIRST call of a process (lazy WASM
// instantiate plus one embed per prototype, cached thereafter), 1.9ms every
// call after, and 0.003ms for small talk, which is suppressed before any embed.
// The first chat turn after a boot therefore pays ~120ms before the first
// token. Called out because the archived reliability-harness plan dropped a
// pre-flight planner for taxing every query 1.5-4s — this is two orders of
// magnitude under that, and unlike the planner it costs nothing on the turns it
// declines. Nothing warms the embedder at boot today; if that 120ms ever
// matters, warm it there rather than making this lane conditional.
import { rankPrototypeSets, isSmallTalk } from "../facts/similarity.ts";
import { config } from "../config.ts";

// Paraphrases of the INTENT, deliberately NOT the sentences in the eval corpus
// (scripts/eval/eval-complexity-queries.ts) — the bakeoff measures
// generalization against these, not string-recall. Same convention as
// concepts-prefetch.ts's CENSUS_PROTOTYPES.
export const COMPLEXITY_PROTOTYPES: Record<string, string[]> = {
  enumeration: [
    "what are all the things of this kind in the atlas?",
    "list every item in this category across the corpus",
    "give me a complete roster of these entities",
    "how many of these exist and what are they?",
    "show me the full set, not just a few examples",
  ],
  synthesis: [
    "build me a summary that pulls from many documents",
    "what overall picture emerges from the whole corpus?",
    "produce a report combining several sources",
    "what patterns show up across the entire collection?",
    "write an overview of this whole body of documents",
  ],
};

// The competing class for THIS router: one named subject, however
// enumerative-sounding the words around it. Deliberately NOT
// facts/similarity.ts's ATLAS_PROTOTYPES — a whole-corpus question already IS
// an atlas question, so that suppressor would stand this lane down on sight.
//
// The last three exist because of a measured failure: "what are the features
// of <doc title>?" out-scored EVERY true positive on the first run. They pull
// it down. They do not eliminate it — see the margin note in config.ts.
export const COMPLEXITY_NEGATIVE_PROTOTYPES = [
  "what does the Keel Accord say about multisig authority?",
  "who is responsible for onboarding a new facilitator?",
  "what is the value of the stability fee parameter?",
  "where is the Emergency Shutdown Module defined?",
  "what are the requirements to become a delegate?",
  "explain this single section to me",
  "what changed in this document last month?",
  "show me the addresses for the SkyLink multisig",
  "what capabilities does this one agent have?",
  "tell me the properties of this particular scope",
  "what does this individual role involve?",
];

/**
 * Does this question look like whole-corpus enumeration or synthesis?
 *
 * Production calls this with no override; `pnpm eval:complexity` calls this
 * exact function with one to sweep thresholds, so eval and server can never
 * diverge on the rule (see concepts-prefetch.ts's identical note on
 * routeCensuses).
 *
 * Small-talk gated. Atlas-subject NOT gated, and that is the load-bearing
 * difference from every other consumer of this mechanism: `namesAtlasSubject`
 * is what keeps the features lane's false-fire rate at 1 in 184, but here it
 * stands down on 18 of 28 genuine positives (measured) — whole-corpus
 * questions are MADE of atlas vocabulary ("map out the entities the atlas
 * recognizes"). For facts, naming a subject implies the question is not about
 * the app. For complexity it implies nothing. Do not add it back.
 */
export function looksComplex(question: string, margin = config.chatComplexitySimilarityMargin): boolean {
  if (!config.chatFactSimilarity || isSmallTalk(question)) return false;
  const ranked = rankPrototypeSets(question, COMPLEXITY_PROTOTYPES, COMPLEXITY_NEGATIVE_PROTOTYPES);
  return ranked.length > 0 && ranked[0]!.margin >= margin;
}
