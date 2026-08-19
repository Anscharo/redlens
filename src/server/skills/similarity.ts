// The similarity lane: does this question LOOK like the kind of question a
// skill answers, even when the skill's deterministic trigger misses it?
//
// Runs on ternlight — a 384-dim ternary sentence embedder compiled to WASM,
// bundled in the package (no network, no API key, ~2ms/embed), so it keeps the
// registry's guarantee that a turn costs microseconds-to-milliseconds and never
// leaves the process.
//
// It is a SECOND lane, never a replacement, and the bakeoff is why
// (scripts/eval/eval-skills.ts, 241 labeled questions): the model scores the
// SHAPE of a question, not its subject. "what are the features of External
// Platforms?" reads as a product question to it, and "what can i do with
// redline sky atlas?" — a real product question — scores NEGATIVE because the
// atlas words dominate. Deterministic matching knows subjects; the embedding
// knows shape. Hence: regex fires on its own, and the similarity lane fires
// only when the question names no real atlas subject and is not small talk.
import { embed, cosineSim } from "@ternlight/base";
import { config } from "../config.ts";
import { matchGlossary, matchQuestionEntities } from "../prefetch.ts";
import type { Indexes } from "../retrieval/indexes.ts";

// The competing intent every skill is scored against: a question about the
// atlas, not about the app. The margin (best skill prototype − best atlas
// prototype) is what separates "what can this app do" from "what can this
// agent do" — the same sentence with a different subject, which no absolute
// threshold can split (measured: absolute cosine tops out at F1 0.55).
const ATLAS_PROTOTYPES = [
  "what does the atlas say about this rule?",
  "what can this agent do?",
  "who is responsible for this process?",
  "what is the definition of this term?",
  "what are the requirements for a facilitator?",
  "which documents cover this scope?",
  "what changed in this document recently?",
  "what is the value of this parameter?",
];

// Greetings and acknowledgements. They sit near the boundary because they are
// equally unlike both prototype sets, and injecting a features guide on
// "thanks!" reads as broken — so they are excluded before scoring, not by it.
//
// Word-set rather than a pattern, so a greeting that PREFIXES a real question
// stays a real question: "hi, show me around" keeps its content word and is
// scored normally, while "thanks, that helped" reduces to nothing. Deliberately
// NARROWER than verify/smalltalk.ts's isUncheckableAnswer, which flags anything
// ungroundable and would swallow "give me a tour" — the exact questions this
// lane exists to catch. Don't unify them.
const SMALLTALK_WORDS = new Set([
  "hi", "hey", "hello", "yo", "sup", "good", "morning", "afternoon", "evening",
  "thanks", "thank", "thx", "ty", "cheers", "appreciate", "appreciated",
  "ok", "okay", "cool", "nice", "great", "awesome", "perfect", "excellent",
  "bye", "goodbye", "see", "ya", "later", "night",
  "you", "u", "it", "that", "this", "was", "is", "are", "very", "really", "so",
  "much", "helpful", "helped", "there", "im", "i", "am", "a", "lot",
]);

export function isSmallTalk(question: string): boolean {
  const words = question.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => SMALLTALK_WORDS.has(w));
}

const prototypeVectors = new Map<string, Float32Array>();
function protoVec(text: string): Float32Array {
  let v = prototypeVectors.get(text);
  if (!v) prototypeVectors.set(text, (v = embed(text)));
  return v;
}

const bestSim = (v: Float32Array, prototypes: string[]) => Math.max(...prototypes.map((p) => cosineSim(v, protoVec(p))));

// Doc titles are the expensive half of the subject check (one pass over every
// document), and Indexes is rebuilt only when the atlas moves — so cache the
// set against the index object itself rather than recomputing per question.
const titlesByIndex = new WeakMap<Indexes, string[]>();
function atlasTitles(ix: Indexes): string[] {
  let titles = titlesByIndex.get(ix);
  if (!titles) {
    titles = [
      ...new Set(
        [...ix.docMap.values()]
          .map((d) => d.title.toLowerCase())
          .filter((t) => t.length >= 8 && t.split(/\s+/).length >= 2),
      ),
    ];
    titlesByIndex.set(ix, titles);
  }
  return titles;
}

/** Does the question name a real glossary term, entity, or document title? */
export function namesAtlasSubject(ix: Indexes, question: string): boolean {
  if (matchGlossary(ix, question).length > 0) return true;
  if (matchQuestionEntities(ix, question).length > 0) return true;
  const lower = question.toLowerCase();
  return atlasTitles(ix).some((t) => lower.includes(t));
}

/**
 * Should `prototypes`' skill fire on this question, on shape alone? Callers
 * still OR this with the skill's own deterministic trigger.
 *
 * The default margin is PERMISSIVE on purpose: injected context is read by a
 * large model that can ignore a block it doesn't need, so over-injecting costs
 * a couple of thousand discarded tokens while under-injecting can lose the
 * answer. Held out (scripts/eval/eval-skills.ts): 25/28 product questions vs
 * the regex lane's 6/28, at 5 false fires in 92 non-product questions — about
 * 130 wasted tokens per atlas turn on average, against 2,000 on every turn if
 * the guide were simply always injected.
 */
export function looksLikeSkillQuestion(ix: Indexes, question: string, prototypes: string[]): boolean {
  if (!config.chatSkillSimilarity || prototypes.length === 0) return false;
  if (isSmallTalk(question) || namesAtlasSubject(ix, question)) return false;
  const v = embed(question); // not cached — see protoVec
  return bestSim(v, prototypes) - bestSim(v, ATLAS_PROTOTYPES) >= config.chatSkillSimilarityMargin;
}

/**
 * Rank several prototype SETS against one question — the routing case a
 * single skill's `prototypes` array can't express (skills/types.ts): "which
 * one of N buckets, if any" rather than "does this one skill fire". One embed
 * call, scored against every set and a single shared negative set, sorted by
 * margin descending so a caller can take the top few above its own threshold.
 *
 * Deliberately does NOT apply ATLAS_PROTOTYPES or isSmallTalk itself — unlike
 * the single-skill case, a router's competing class isn't always "atlas vs
 * app" (the concept-census lane's competing class is "cross-cutting analysis
 * vs specific document lookup", a different negative set — see
 * concepts-prefetch.ts's CENSUS_NEGATIVE_PROTOTYPES). Callers own their own
 * suppressors and pass whatever negative set fits their routing decision.
 */
export function rankPrototypeSets(
  question: string,
  sets: Record<string, string[]>,
  negatives: string[],
): { slug: string; score: number; margin: number }[] {
  const v = embed(question); // not cached — see protoVec
  const negScore = bestSim(v, negatives);
  return Object.entries(sets)
    .map(([slug, prototypes]) => {
      const score = bestSim(v, prototypes);
      return { slug, score, margin: score - negScore };
    })
    .sort((a, b) => b.margin - a.margin);
}

// Exported for the bakeoff, so eval and production can never diverge on the
// negative prototypes or the small-talk rule.
export { ATLAS_PROTOTYPES };
