// Deterministic pre-lookup for /api/chat: before the first LLM request, match
// the user's message against the glossary (longest-phrase-first over the
// alias-flattened lookup) and the entity roster (name/slug containment), and
// seed the findings as a synthetic tool round in the transcript. High-precision
// lanes only — no speculative search — so a hit is always worth the tokens and
// a miss injects nothing. Because it rides the transcript as a real-looking
// tool exchange, the verifier evidence, quote-grounding, and citation checks
// all consume it with zero changes (evidenceFromTranscript walks tool messages
// generically).
import type OpenAI from "openai";
import type { Indexes, Entity } from "./retrieval/indexes.ts";
import type { GlossaryEntry } from "../lib/glossaryLookup.ts";
import { matchEntities, entityAliases } from "./retrieval/entity-resolve.ts";
import { entityKindLabel } from "./retrieval/entity-kind.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const MAX_DEFINITIONS = 6;
// 8 Prime Agents today, each minting its own row for a shared primitive/instance
// name (e.g. "Asset Liability Management Rental Primitive") — 9 gives headroom
// for a query that matches all of them plus one more before truncating.
const MAX_ENTITIES = 9;
const DEFINITION_MAX_CHARS = 700;
// Longest glossary key today is 3 words; headroom without scanning cost.
const MAX_NGRAM = 6;
// Only true filler for unigram glossary matching — same philosophy as
// entity-resolve.ts: never domain words, which are load-bearing in terms.
const STOP = new Set(["the", "a", "an", "of", "and", "or", "for", "to", "in", "is", "are", "what", "who", "how", "does", "do"]);

export const PREFETCH_TOOL_NAME = "atlas_prefetch";

const NOTE =
  "Deterministic pre-lookup over the user's message (glossary term match + entity name match) — ran before you, at zero cost. " +
  "If these definitions and entities already answer the question, answer directly now with citations to the doc_ids below; otherwise use tools as normal.";

interface DefinitionRow {
  term: string;
  definition: string;
  doc_id: string;
  doc_no: string;
  title: string;
}

interface EntityRow {
  slug: string;
  name: string;
  kind: string;
  agent: string | null;
  active: boolean;
  defining_doc_id: string | null;
  defining_doc_title: string | null;
}

// primitive/instance/invocation entities are minted one-per-Prime-Agent and
// all share the same generic `name` ("Asset Liability Management Rental
// Primitive") — meta.agent_doc_id (set by graph-instances.mjs) is the only
// thing that tells them apart. Resolve it to the agent's title so the model
// isn't handed several identical-looking rows it can't distinguish.
const AGENT_SCOPED_TYPES = new Set(["primitive", "instance", "invocation"]);

function ownerAgentName(ix: Indexes, entity: Entity): string | null {
  if (!AGENT_SCOPED_TYPES.has(entity.entity_type) || !entity.meta) return null;
  try {
    const m = JSON.parse(entity.meta) as { agent_doc_id?: unknown };
    return typeof m.agent_doc_id === "string" ? (ix.docMap.get(m.agent_doc_id)?.title ?? null) : null;
  } catch {
    return null;
  }
}

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) ?? [];
}

// Exact key, then a naive singular ("tenets" → "tenet") on the last word.
function lookupKey(glossary: Map<string, GlossaryEntry[]>, key: string): GlossaryEntry[] | undefined {
  const hit = glossary.get(key);
  if (hit) return hit;
  if (key.endsWith("s") && !key.endsWith("ss")) return glossary.get(key.slice(0, -1));
  return undefined;
}

// Full Levenshtein distance (strings here are single words, a few chars —
// no need for src/server/preview/identity.ts's bounded early-exit variant,
// which serves a different domain).
function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[a.length][b.length];
}

// Longer words tolerate more typo distance; short words (<=4 chars) must be
// exact — too easy to collide otherwise ("act" vs "art" is 1 edit apart but
// unrelated). Same banding as preview/identity.ts's wordEq, different domain.
function fuzzyTolerance(len: number): number {
  return len <= 4 ? 0 : len <= 8 ? 1 : 2;
}

// Closest single-word glossary key within typo tolerance of `key` — multi-word
// keys are excluded (a one-token typo shouldn't fuzzy-match a whole phrase).
// Only called for true unigrams, and only once the exact/plural lookupKey
// already missed. Ties broken alphabetically for determinism.
function fuzzyLookupKey(glossary: Map<string, GlossaryEntry[]>, key: string): GlossaryEntry[] | undefined {
  const tol = fuzzyTolerance(key.length);
  if (tol === 0) return undefined;
  let best: string | undefined;
  let bestDist = Infinity;
  for (const k of glossary.keys()) {
    if (k.includes(" ") || Math.abs(k.length - key.length) > tol) continue;
    const dist = levenshtein(key, k);
    if (dist <= tol && (dist < bestDist || (dist === bestDist && (best === undefined || k < best)))) {
      best = k;
      bestDist = dist;
    }
  }
  return best ? glossary.get(best) : undefined;
}

// Longest-phrase-first n-gram scan over the glossary lookup. Matched spans are
// consumed so "universal alignment assumption" doesn't also fire "universal
// alignment"; unigrams skip stopwords and short tokens.
export function matchGlossary(ix: Indexes, question: string): { term: string; entries: GlossaryEntry[] }[] {
  if (ix.glossary.size === 0) return [];
  const toks = words(question);
  const consumed = new Array<boolean>(toks.length).fill(false);
  const out: { term: string; entries: GlossaryEntry[] }[] = [];
  const seen = new Set<string>();

  for (let n = Math.min(MAX_NGRAM, toks.length); n >= 1; n--) {
    for (let i = 0; i + n <= toks.length; i++) {
      if (consumed.slice(i, i + n).some(Boolean)) continue;
      if (n === 1 && (STOP.has(toks[i]) || toks[i].length < 3)) continue;
      const key = toks.slice(i, i + n).join(" ");
      const entries = lookupKey(ix.glossary, key) ?? (n === 1 ? fuzzyLookupKey(ix.glossary, key) : undefined);
      if (!entries) continue;
      consumed.fill(true, i, i + n);
      const term = entries[0]?.term ?? key;
      if (seen.has(term)) continue;
      seen.add(term);
      out.push({ term, entries });
    }
  }
  return out;
}

// Entities whose full name or slug token set appears in the question — strict
// containment on top of matchEntities' scoring, so "spark foundation" matches
// the spark-foundation entity but plain "spark" never drags it in.
export function matchQuestionEntities(ix: Indexes, question: string): EntityRow[] {
  const qTokens = new Set(words(question));
  const out: EntityRow[] = [];
  for (const { entity } of matchEntities(ix, question, 20)) {
    const contained = [entity.slug, entity.name, ...entityAliases(entity)].some((cand) => {
      const t = words(cand ?? "");
      return t.length > 0 && t.every((w) => qTokens.has(w));
    });
    if (!contained) continue;
    const definingDoc = entity.defining_doc_id ? ix.docMap.get(entity.defining_doc_id) : undefined;
    out.push({
      slug: entity.slug,
      name: entity.name,
      kind: entityKindLabel(entity.entity_type, entity.subtype),
      agent: ownerAgentName(ix, entity),
      active: Boolean(entity.is_active),
      defining_doc_id: entity.defining_doc_id,
      defining_doc_title: definingDoc?.title ?? null,
    });
    if (out.length >= MAX_ENTITIES) break;
  }
  return out;
}

export interface Prefetch {
  content: string; // the tool-result JSON the model reads
  definitions: number;
  entities: number;
}

export function buildPrefetch(ix: Indexes, question: string): Prefetch | null {
  const definitions: DefinitionRow[] = [];
  for (const { entries } of matchGlossary(ix, question)) {
    for (const e of entries) {
      if (definitions.length >= MAX_DEFINITIONS) break;
      const doc = ix.docMap.get(e.nodeId);
      definitions.push({
        term: e.term,
        definition: e.content.length > DEFINITION_MAX_CHARS ? `${e.content.slice(0, DEFINITION_MAX_CHARS)}…` : e.content,
        doc_id: e.nodeId,
        doc_no: e.docNo,
        title: doc?.title ?? e.term,
      });
    }
  }
  const entities = matchQuestionEntities(ix, question);
  if (definitions.length === 0 && entities.length === 0) return null;

  return {
    content: JSON.stringify({ note: NOTE, definitions, entities }),
    definitions: definitions.length,
    entities: entities.length,
  };
}

// The synthetic tool round appended after the latest user message: an assistant
// tool_call + its result, in OpenAI wire shape. Regenerated fresh each turn
// (only user/assistant contents persist), so every turn prefetches its own
// message. The verifier and citation checks pick it up as ordinary evidence.
export function prefetchRound(question: string, prefetch: Prefetch): Msg[] {
  const id = "call_prefetch";
  return [
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id, type: "function", function: { name: PREFETCH_TOOL_NAME, arguments: JSON.stringify({ text: question.slice(0, 200) }) } }],
    },
    { role: "tool", tool_call_id: id, content: prefetch.content },
  ];
}
