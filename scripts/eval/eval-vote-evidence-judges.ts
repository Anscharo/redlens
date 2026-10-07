// What the LLM arm of the vote-evidence eval is asked, and how its answers are
// read. The decision models get the production questions
// (src/server/vote-evidence/requests.ts) over the same state. Pure: no network,
// so the shapes are testable; the entry point (eval-vote-evidence.ts) sends them.
//
// The LLM answers one JSON object. No arm sees the shipped matcher's verdict or
// the gold label.

import type { PollCase, SubjectCase } from "./eval-vote-evidence-cases.ts";
import { pollState, subjectState } from "../../src/server/vote-evidence/requests.ts";

export interface Msg {
  role: "system" | "user";
  content: string;
}

const SUBJECT_SYSTEM = [
  "You check claims in the Sky Atlas against Sky executive votes. You get one atlas sentence that names a dated Executive Vote, the text of the atlas document it comes from, and that executive's title, summary and action sections.",
  'Answer with one JSON object: {"anchor": boolean, "carried": "yes" | "no" | "unclear", "section": string, "quote": string}.',
  "anchor: true when the sentence uses the vote only as a point in time (a start date or deadline for some other requirement) rather than saying the vote did something.",
  "carried: whether the executive carries out the specific action the sentence says it did, counting actions inside Prime Agent proxy spell sections; similar actions for other parties do not count. A party may appear under an earlier name: treat it as the same party when an address or alias in the atlas document ties them.",
  'section: the heading of the section that carries it, or "none". quote: a short verbatim line from that section, or "".',
].join("\n");

const POLL_SYSTEM = [
  "You check dated claims in the Sky Atlas against Sky governance polls. You get one atlas sentence and a numbered list of passed polls.",
  'Answer with one JSON object: {"match": "p<i>" | "none", "quote": string}.',
  "match: the poll that authorises, sets or changes the specific dated arrangement the sentence describes (same arrangement, parties and date), or \"none\" when no listed poll does. A poll that only edits other parts of the same document does not count.",
  'quote: the verbatim poll line that matches, or "".',
].join("\n");

export function subjectMessages(c: SubjectCase): Msg[] {
  return [
    { role: "system", content: SUBJECT_SYSTEM },
    { role: "user", content: JSON.stringify(subjectState(c)) },
  ];
}

export function pollMessages(c: PollCase): Msg[] {
  const state = pollState(c);
  const polls = state.polls.map((p, i) => ({ id: `p${i}`, ...p }));
  return [
    { role: "system", content: POLL_SYSTEM },
    { role: "user", content: JSON.stringify({ claim: state.claim, polls }) },
  ];
}

function parseObject(text: string): Record<string, unknown> | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export interface LlmSubjectAnswer {
  anchor: boolean;
  carried: "yes" | "no" | "unclear";
  quote: string;
}

/** Null for an answer that is not the asked-for object: scored as a failure, never guessed. */
export function parseLlmSubject(text: string): LlmSubjectAnswer | null {
  const o = parseObject(text);
  if (!o || typeof o.anchor !== "boolean" || !["yes", "no", "unclear"].includes(String(o.carried))) return null;
  return { anchor: o.anchor, carried: o.carried as LlmSubjectAnswer["carried"], quote: typeof o.quote === "string" ? o.quote : "" };
}

/** The candidate id, "none", or null for an answer naming no listed poll. */
export function parseLlmPoll(text: string, ids: readonly string[]): string | null {
  const o = parseObject(text);
  const match = o ? String(o.match) : "";
  return match === "none" || ids.includes(match) ? match : null;
}
