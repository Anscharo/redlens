// Concepts lane for the deterministic prefetch (prefetch.ts): match the
// user's message against the 10 concept censuses (src/lib/conceptsCensus.ts)
// and inject compact summary rows — counts + detection signature, never
// member lists — so cross-cutting questions ("how many registries are empty?",
// "which document types are unused?") reach the model with the census in hand
// instead of relying on it thinking to call a tool. Same philosophy as the
// glossary/entity lanes: a hit is always worth the tokens, a miss injects
// nothing. Drill-down to members goes through atlas_describe
// sections:["censuses:<slug>"] (tools-censuses.ts).
//
// TWO trigger lanes, same shape as skills/similarity.ts's story for the
// features skill but a different competing class. Regex (SIGNATURES) is
// high-precision but low-recall: measured 2026-08-19, 1 of 20 natural
// paraphrases hit ("are there registries with nothing in them?" hits on
// "registries"; "which lists in the atlas are still empty?" — same
// question, no census vocabulary — misses). `pnpm eval:census` bakeoff
// (scripts/eval/eval-census.ts, 202 labeled questions): similarity lifts
// routing accuracy from regex's 30% to 86% at ZERO false fires, both on the
// labeled corpus and on a real-traffic check (67 distinct chat messages) —
// see config.ts's chatCensusSimilarityMargin comment for why the shipped
// margin (0.4) sits well above what the labeled corpus alone would have
// picked: the real-traffic check caught open-ended questions ("trace the
// governance path for an amendment", "generate 10 did-you-know blurbs") that
// the synthetic negative pool never produced but that fired anyway at a
// lower margin. False fires ARE cheap here (373B for one census summary,
// 1657B for three, vs ~8KB for the features guide) — that's what justifies
// running the similarity lane at all — but "cheap" set the bar for adopting
// it, not the operating point, which real traffic decided.
//
// The competing class is NOT skills/similarity.ts's ATLAS_PROTOTYPES
// ("atlas question vs app question") — a census question already IS an
// atlas question, so that suppressor would stand this lane down on sight.
// The real competitor is "cross-cutting analysis vs specific document
// lookup" ("which registries are empty" vs "what does the Keel Accord
// say") — CENSUS_NEGATIVE_PROTOTYPES below.
import { rankPrototypeSets, isSmallTalk } from "./skills/similarity.ts";
import { config } from "./config.ts";
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

// Similarity-lane prototypes, one set per slug — the routing case
// skills/types.ts's single `prototypes` array can't express (1-of-10, take
// up to 3), hence skills/similarity.ts's rankPrototypeSets instead of
// looksLikeSkillQuestion. Paraphrases of what each census actually answers,
// deliberately NOT the sentences in the eval corpus (eval-census-queries.ts)
// — the bakeoff measures generalization against these, not string-recall.
export const CENSUS_PROTOTYPES: Record<CensusSlug, string[]> = {
  "registry-liveness": [
    "which registries in the atlas are empty?",
    "how many 'list of' documents have zero entries?",
    "are any of our catalogs unpopulated?",
    "which directories are still live vs abandoned shells?",
    "do all the registries actually have members listed?",
  ],
  "ghost-doc-types": [
    "which document types were designed but never used?",
    "are there spec'd document types with no real instances?",
    "what types appear in the type registry but nowhere else?",
    "which planned document categories stayed empty?",
    "what document types exist only on paper?",
  ],
  "cross-scope-duplication": [
    "do two different scopes ever define the same concept twice?",
    "which document titles repeat across separate scopes?",
    "are there parallel, duplicated write-ups of one idea?",
    "which concepts got documented independently in multiple scopes?",
    "is there redundant coverage of the same topic in different sections?",
  ],
  "transitionary-measures": [
    "which provisions are explicitly temporary or transitional?",
    "what stopgap rules exist until something permanent replaces them?",
    "are there interim measures called out anywhere?",
    "which sections describe a bridge arrangement, not a final rule?",
    "what short-term fixes does the atlas define?",
  ],
  "formula-docs": [
    "which documents contain a mathematical formula?",
    "where are calculations or equations written out?",
    "does any section carry LaTeX-style math notation?",
    "which docs define something with an actual formula?",
    "where does the atlas do arithmetic or math?",
  ],
  "prohibition-language": [
    "which rules explicitly forbid an action?",
    "where does the atlas say something is not permitted?",
    "what is disallowed according to the rules?",
    "which documents use prohibition wording?",
    "what actions are banned outright?",
  ],
  "empty-scaffolding": [
    "which status directories have nothing filed in them?",
    "are there lifecycle buckets that are still just scaffolding?",
    "what instance folders are completely empty?",
    "which primitive status buckets never got populated?",
    "are any of the active/suspended/completed folders bare?",
  ],
  "numbered-step-docs": [
    "which documents lay out an ordered, numbered procedure?",
    "where does the atlas give step-by-step instructions?",
    "which sections read like a numbered checklist?",
    "are there docs written as a sequential 1-2-3 process?",
    "which write-ups number their steps explicitly?",
  ],
  "title-templates": [
    "which document titles are reused as a template across the atlas?",
    "are there recurring, boilerplate title patterns?",
    "which docs share an identical templated name in different places?",
    "what standard title formats repeat throughout the corpus?",
    "which titles follow the same fixed template everywhere?",
  ],
  "normative-title-families": [
    "which documents belong to the same normative rule family?",
    "what groups of titles share a common normative theme?",
    "are there clusters of rules named after prohibition, suspension, or derecognition?",
    "which titles fall under one of the atlas's normative categories?",
    "what normative rule groupings does the atlas use?",
  ],
};

// The competing class for THIS router: a specific document lookup, not a
// cross-cutting finding. Deliberately NOT skills/similarity.ts's
// ATLAS_PROTOTYPES — see the header comment for why that suppressor doesn't
// apply here. Exported so eval-census.ts scores the exact set that ships.
export const CENSUS_NEGATIVE_PROTOTYPES = [
  "what does the Keel Accord say about multisig authority?",
  "who is responsible for onboarding a new facilitator?",
  "what is the value of the stability fee parameter?",
  "where is the Emergency Shutdown Module defined?",
  "what are the requirements to become a delegate?",
  "list the members of the Core Facilitators registry",
  "what changed in this document last month?",
  "show me the addresses for the SkyLink multisig",
];

/**
 * Which census slugs (if any) this question routes to — regex ∪ similarity,
 * capped at MAX_CENSUSES, regex-first (its order is the existing tie-break).
 * The one routing function: production calls it with no override (`margin`
 * defaults to `config.chatCensusSimilarityMargin`), and `pnpm eval:census`
 * calls this exact function with an override to sweep thresholds — never a
 * parallel reimplementation of the arithmetic, which would let eval and
 * server silently diverge (see skills/similarity.ts's identical note on
 * looksLikeSkillQuestion).
 *
 * Small-talk gated, atlas-subject NOT gated (constraint: a census question
 * already names atlas vocabulary — see header). `config.chatSkillSimilarity`
 * is the shared kill switch for every embedding lane (features' and this one).
 */
export function routeCensuses(question: string, margin = config.chatCensusSimilarityMargin): CensusSlug[] {
  const regexSlugs = matchConceptCensuses(question);
  if (!config.chatSkillSimilarity || isSmallTalk(question)) return regexSlugs;
  const ranked = rankPrototypeSets(question, CENSUS_PROTOTYPES, CENSUS_NEGATIVE_PROTOTYPES);
  const simSlugs = ranked.filter((r) => r.margin >= margin).map((r) => r.slug as CensusSlug);
  return [...new Set([...regexSlugs, ...simSlugs])].slice(0, MAX_CENSUSES);
}

export interface CensusPrefetchRow extends CensusSummaryRow {
  members_hint: string;
}

export const CENSUSES_NOTE =
  "These censuses are our own analysis findings — deterministic computations over the atlas corpus, not atlas text. " +
  "When answering from them, attribute explicitly ('our census shows…', 'our analysis finds…'); " +
  "never present them as something the atlas itself states.";

export function censusPrefetchRows(ix: Indexes, question: string): CensusPrefetchRow[] {
  const slugs = routeCensuses(question);
  if (slugs.length === 0) return [];
  const all = conceptsCensusFor(ix);
  return slugs.map((slug) => ({
    ...censusSummary(all[slug]),
    members_hint: `For the full member list call atlas_describe with sections:["censuses:${slug}"].`,
  }));
}
