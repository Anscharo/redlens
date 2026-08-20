// The facts registry — every block of knowledge that can be auto-injected into
// a chat turn, in one list. Before this, each lane was hand-wired into
// buildPrefetch and there was no shared shape, so "add another kind of context"
// meant editing the assembly function. Now: write a Fact, add it here.
//
// All facts ride ONE synthetic tool round in the transcript (factRound), so
// the verifier, quote-grounding and citation checks consume whatever they
// inject as ordinary turn evidence with zero changes — evidenceFromTranscript
// walks tool messages generically. The wire name stays `atlas_prefetch`: it is
// what the model and the stored transcripts have always seen, and it is still
// accurate (this all runs BEFORE the model's first request).
//
// CHAT_PREFETCH=0 turns the whole registry off (config.chatPrefetch, applied by
// the caller) — it is the kill switch for every fact at once.
import type OpenAI from "openai";
import { definitionRows, matchQuestionEntities } from "../prefetch.ts";
import { censusPrefetchRows, CENSUSES_NOTE } from "../concepts-prefetch.ts";
import { featuresFact } from "./features.ts";
import { looksLikeFactQuestion } from "./similarity.ts";
import type { Fact, FactContext } from "./types.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export const FACT_TOOL_NAME = "atlas_prefetch";

const NOTE =
  "Deterministic pre-lookup over the user's message — ran before you, in code, at zero cost. " +
  "If what follows already answers the question, answer directly now with citations to the doc_ids below; otherwise use tools as normal. " +
  "Each section carries its own handling note where one applies.";

// Order is the transcript order, and the tie-break when several fire: atlas
// facts first (definitions, then the entities they hang off, then our
// cross-cutting analyses), product documentation last.
export const FACTS: Fact[] = [
  {
    id: "glossary",
    what: "Atlas definitions for glossary terms named in the question (longest-phrase-first, plural + typo tolerant).",
    summarize: (n) => `${n} glossary definition${n === 1 ? "" : "s"}`,
    run: ({ ix, question }) => {
      const rows = definitionRows(ix, question);
      return { key: "definitions", value: rows, count: rows.length };
    },
  },
  {
    id: "entities",
    what: "Roster rows for entities the question names in full (slug/name/alias containment).",
    summarize: (n) => `${n} entit${n === 1 ? "y" : "ies"} from the roster`,
    run: ({ ix, question }) => {
      const rows = matchQuestionEntities(ix, question);
      return { key: "entities", value: rows, count: rows.length };
    },
  },
  {
    id: "censuses",
    what: "Concept-census summaries (counts only) for questions phrased in census vocabulary.",
    summarize: (n) => `${n} census summar${n === 1 ? "y" : "ies"} (our own analysis)`,
    run: ({ ix, question }) => {
      const rows = censusPrefetchRows(ix, question);
      return { key: "censuses", value: rows, note: CENSUSES_NOTE, count: rows.length };
    },
  },
  featuresFact,
];

export interface FactInjection {
  content: string; // the tool-result JSON the model reads
  counts: Record<string, number>; // rows per fact id — telemetry, and what fired
  /** What ran, in the user's words — the SSE route shows this in the trace
   *  and the stage ticker, so injected context is never silent work. */
  used: { id: string; summary: string }[];
}

// Run every fact against the turn. Returns null when none fires, which is the
// common case and injects nothing at all.
export function runFacts(ctx: FactContext): FactInjection | null {
  const payload: Record<string, unknown> = { note: NOTE };
  const counts: Record<string, number> = {};
  const used: FactInjection["used"] = [];

  for (const fact of FACTS) {
    // A fact that declares prototypes also gets the similarity lane: does the
    // turn LOOK like a question it answers, whatever words it used? Scored
    // per fact, since each has its own prototypes; the shared atlas-question
    // prototypes and the suppressors live in similarity.ts.
    const semanticHit = fact.prototypes ? looksLikeFactQuestion(ctx.ix, ctx.question, fact.prototypes) : false;
    const block = fact.run({ ...ctx, semanticHit });
    if (!block || block.count === 0) continue;
    payload[block.key] = block.value;
    if (block.note) payload[`${block.key}_note`] = block.note;
    counts[fact.id] = block.count;
    used.push({ id: fact.id, summary: fact.summarize(block.count) });
  }

  if (used.length === 0) return null;
  return { content: JSON.stringify(payload), counts, used };
}

// "a", "a and b", "a, b and c" — the stage-ticker line for what just ran.
export function summarizeFacts(injection: FactInjection): string {
  const parts = injection.used.map((u) => u.summary);
  const list = parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `Recalled ${list}`;
}

// The synthetic tool round appended after the latest user message: an assistant
// tool_call + its result, in OpenAI wire shape. Regenerated fresh each turn
// (only user/assistant contents persist), so every turn runs its own facts.
export function factRound(question: string, injection: FactInjection): Msg[] {
  const id = "call_prefetch";
  return [
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id, type: "function", function: { name: FACT_TOOL_NAME, arguments: JSON.stringify({ text: question.slice(0, 200) }) } },
      ],
    },
    { role: "tool", tool_call_id: id, content: injection.content },
  ];
}
