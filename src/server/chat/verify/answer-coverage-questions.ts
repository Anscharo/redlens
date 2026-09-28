// Jev question definitions for the "did it answer the question?" check
// (answer-coverage.ts). Wording is load-bearing: every threshold in
// answer-coverage.ts was measured against exactly these strings, so a reword
// means re-running the offline measurement (docs/plans/jev-typesafe.md §2).
//
// Relative to the research wording, two edits: `partial` is gone (it did not
// detect under-answering; the per-part Nouls below do, and name the part),
// and `answers` now says outright that covering only some parts still counts
// — without that, a partial reply's mass had nowhere to go but `declines` or
// `deflects`. Measured after the edit: all 20 replies the old wording ruled
// `partial` came back `answers`, none `deflects` or `asks`.

export const RESPONDS_QUESTION = {
  type: "choice" as const,
  instructions:
    "Judge how the assistant's reply in `answer` responds to the user's request in `question`. Judge ONLY whether it responds to what was asked — not whether its facts are correct, sourced, or detailed enough. A wrong or hedged answer to the question still responds to it.",
  criteria: {
    answers: {
      what: "The reply delivers what the question asks for — the requested facts, list, explanation, recommendations or report. It still counts if some content may be wrong or hedged, if it notes that a few details are not recorded, or if it covers only some parts of a multi-part question.",
    },
    declines: {
      what: "The reply's main response is that the requested information is not recorded, not specified or not available in the atlas (or is outside what it can cover), stated as its finding.",
      not_for: "Promising to look something up or come back later.",
      examples: ["The atlas does not record payout amounts for any agent, so I cannot list them."],
    },
    deflects: {
      what: "The reply does not answer yet: it announces, promises or describes a lookup or other work it has not done, or stalls, without addressing the question.",
      not_for: "Saying the atlas lacks the information.",
      examples: ["One moment while I search the atlas.", "Let me pull the relevant documents and get back to you."],
    },
    asks: {
      what: "Instead of answering, the reply asks the user a clarifying question about what they want (which meaning, which subset, which format).",
      not_for: "A reply that answers and then offers more; announcing a lookup it has not done.",
    },
  },
};

// One Noul per question part (question-parts.ts). The `true` criterion counts
// an explicit "the atlas doesn't record this" as addressing the part — an
// honest gap is an answer to that part, not a drop.
export function partQuestion(part: string) {
  return {
    type: "noul" as const,
    instructions: `The assistant's reply in \`answer\` addresses this part of the user's request in \`question\`: "${part}".`,
    criteria: {
      true: "The reply gives what this part asks for, or explicitly says the atlas does not specify or record it.",
      false: "The reply skips this part, or only mentions its topic without giving what it asks for.",
    },
  };
}
