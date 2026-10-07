// What the two model arms of the vote-evidence eval are asked, and how their
// answers are read. Pure: no network, so the shapes are testable; the entry
// point (eval-vote-evidence.ts) sends them.
//
// Both arms see the same state. Jev answers typed judgments (a probability per
// Noul); the LLM answers one JSON object. Neither sees the shipped matcher's
// verdict or the gold label.

import type { PollCase, SubjectCase } from "./eval-vote-evidence-cases.ts";

/** Structurally a src/server/jev.ts JevQuestion; declared here so this module stays free of server imports. */
export interface Question {
  type: "noul" | "choice" | "score";
  instructions: unknown;
  criteria?: unknown;
}

export interface Msg {
  role: "system" | "user";
  content: string;
}

// Executive sections go whole: a Prime proxy-spell section runs to 12 KB and
// itemises grant payments deep inside it, and whole executives stay under
// 20 KB. The cap only guards a pathological file.
const SECTION_CHARS = 40_000;
const POLL_CHARS = 6000;
// The claim's own document, for the address or alias that ties a renamed agent to the vote.
const DOCUMENT_CHARS = 3000;

export function subjectState(c: SubjectCase) {
  return {
    claim: { sentence: c.sentence, atlas_document_title: c.title, atlas_document_text: c.documentText.slice(0, DOCUMENT_CHARS), vote_date_named: c.date },
    executive_vote: {
      title: c.vote.title,
      summary: c.vote.summary,
      sections: c.vote.sections.map((s) => ({ heading: s.heading.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"), text: s.text.slice(0, SECTION_CHARS) })),
    },
  };
}

export const SUBJECT_QUESTIONS: Record<string, Question> = {
  anchor: {
    type: "noul",
    instructions:
      "Does the sentence in `claim.sentence` use the Executive Vote it names only as a point in time — a start date or deadline for some other requirement — rather than stating that the vote itself carried out an action?",
  },
  carried: {
    type: "noul",
    instructions:
      "Does the executive vote in `executive_vote` carry out the specific action that `claim.sentence` says this vote carried out? Count an action inside a Prime Agent proxy spell section the executive itemises. A party may appear under an earlier name; treat it as the same party when an address or alias in `claim.atlas_document_text` ties them. Answer no when the executive performs similar actions only for other parties, amounts or assets than the sentence names.",
  },
};

export function pollState(c: PollCase) {
  return {
    claim: { sentence: c.sentence, atlas_document_title: c.title, date: c.date },
    polls: c.candidates.map((p) => ({ date: p.date, title: p.title, body: p.body.slice(0, POLL_CHARS) })),
  };
}

/** One Noul per candidate, `polls[i]` by position; ids match the candidates' `p<i>`. */
export function pollQuestions(c: PollCase): Record<string, Question> {
  return Object.fromEntries(
    c.candidates.map((p, i) => [
      p.id,
      {
        type: "noul" as const,
        instructions:
          `Does the governance poll \`polls[${i}]\` authorise, set or change the specific dated arrangement described in \`claim.sentence\` — ` +
          "the same arrangement, parties and date — rather than only editing other parts of the same document or a similar arrangement for someone else?",
      },
    ]),
  );
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
