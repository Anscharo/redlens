// Labeled corpus for the promised-tool lane (src/server/chat/announcement.ts).
//
// This one scores ANSWERS, not questions — the first of the four similarity
// consumers to do so — so the corpus is built out of assistant text, and the
// negative half is the part that took the work. A false fire spends one extra
// generation and usually returns the same answer; a miss ships "one moment
// while I search the atlas" as the answer and the user has to re-prompt to get
// anything at all. So recall is weighted, but the negatives are chosen to be
// adversarial rather than easy: every class below is a real reason a turn
// legitimately ends with zero tool calls.
//
// Positives are split by whether ANNOUNCEMENT_RE can see them. The `hard` ones
// are phrased around every pattern in it, which is what makes the bakeoff a
// measurement of what the embedding ADDS rather than of string recall.
export interface AnnounceCase {
  text: string;
  fire: boolean;
  note?: string;
}

export const ANNOUNCE_CASES: AnnounceCase[] = [
  // ── Positives the regexes catch ───────────────────────────────────────────
  {
    text:
      'Hello! I\'d be happy to help you with that. Since I only answer based on the Sky Atlas, let me look up the definition and usage of "rate limit ID" for you.\n\nOne moment while I search the atlas.',
    fire: true,
    note: "the observed 2026-08-20 incident, verbatim",
  },
  { text: "Let me dig into that for you.", fire: true },
  { text: "Sure — let me check the atlas for what it says about that role.", fire: true },
  { text: "One moment while I pull the relevant documents.", fire: true },
  { text: "I'll search the atlas and come back with what it says.", fire: true },
  { text: "Give me a second to find the right document.", fire: true },
  { text: "Hold on, I need to consult the governance records first.", fire: true },
  { text: "I'm going to look through the atlas for the answer to that.", fire: true },
  { text: "Happy to help! Let me find the document that covers this.", fire: true },
  { text: "Good question — I'll review what the atlas has on that and report back.", fire: true },
  { text: "Bear with me while I query the relevant scope.", fire: true },
  { text: "I am now searching for the documents that define it.", fire: true },
  { text: "Of course. Let me first retrieve the parameter's defining document.", fire: true },
  { text: "Sure thing. I'll go and check which entities hold that role.", fire: true },
  { text: "Right — one moment, I'm checking the atlas for you.", fire: true },
  { text: "Absolutely. Let me see what the atlas says about this before I answer.", fire: true },

  // ── Positives phrased around every regex (the embedding's job) ────────────
  { text: "Sure thing — pulling the relevant governance documents together for you right now.", fire: true, note: "hard" },
  { text: "Great question. Fetching what the atlas has on that, back shortly.", fire: true, note: "hard" },
  { text: "Happy to help with that. Gathering the details before I answer.", fire: true, note: "hard" },
  { text: "Absolutely — checking the relevant documents now and coming back with what they say.", fire: true, note: "hard" },
  { text: "Of course! First I need to consult the governance records, then I can answer properly.", fire: true, note: "hard" },
  { text: "Working on it — retrieving the documents that cover this topic.", fire: true, note: "hard" },
  { text: "On it. Digging through the relevant scope for you.", fire: true, note: "hard" },
  { text: "Good question! Consulting the atlas about that, and I will follow up shortly.", fire: true, note: "hard" },
  { text: "Sure. Getting the details from the relevant documents before answering.", fire: true, note: "hard" },
  { text: "Right away — collecting what the atlas records about this.", fire: true, note: "hard" },
  { text: "Understood. Reviewing the governance documents so I can answer accurately.", fire: true, note: "hard" },
  { text: "Certainly — the relevant records are being retrieved so I can answer.", fire: true, note: "hard" },

  // ── Negatives: real answers that carry nothing checkable ─────────────────
  { text: "A Rate Limit ID uniquely identifies a rate limit, so the system keeps an independent allowance per transaction.", fire: false, note: "plain answer" },
  { text: "That responsibility sits with the Facilitator, who reviews each submission before it proceeds.", fire: false, note: "plain answer" },
  { text: "Yes, that is correct — the rule applies to every instance of the primitive, not just the first.", fire: false, note: "plain answer" },
  { text: "No, the atlas treats those as separate scopes with separate governance.", fire: false, note: "plain answer" },
  { text: "In short: the Prime Agent proposes, and the Alignment Conserver can object before it takes effect.", fire: false, note: "plain answer" },
  // Regex-hole sentences from the 2026-09-02 review: ordinary answers that the
  // pre-tightening ANNOUNCEMENT_RE fired on (bare `a second`/`a minute` in the
  // wait idiom, bare `see` after "let me", bare `looking`). Pinned so a future
  // regex loosening cannot report zero false fires by never seeing them.
  { text: "A second signer must approve before the transaction can proceed.", fire: false, note: "regex hole (wait idiom)" },
  { text: "This is a second copy of the same document.", fire: false, note: "regex hole (wait idiom)" },
  { text: "A minute of the meeting is reserved for objections.", fire: false, note: "regex hole (wait idiom)" },
  { text: "Let me see. The Facilitator reviews each submission before it proceeds.", fire: false, note: "regex hole (bare see)" },
  { text: "I am looking at two possible readings of that rule.", fire: false, note: "regex hole (bare looking)" },
  // Second round (same review, follow-up pass): interjections leading an
  // answer, not a wait — the idiom now requires standing alone or a
  // first-person retrieval in the same sentence.
  { text: "Hold on, this doesn't add up — the two documents give different thresholds.", fire: false, note: "regex hole (interjection)" },
  { text: "Bear with me — the distinction between those two roles is subtle.", fire: false, note: "regex hole (interjection)" },

  // ── Negatives: product answers from the injected features guide ──────────
  { text: "You can search the atlas, browse entities by role, and export any report as a file.", fire: false, note: "features answer" },
  { text: "The reader lets you expand a document and see its children inline, without leaving the page.", fire: false, note: "features answer" },
  { text: "You can find that on the radar page. Open it, pick the agent, and the responsibilities are listed there.", fire: false, note: "features answer" },
  { text: "Searching the atlas is done from the search bar at the top of the page.", fire: false, note: "features answer" },
  { text: "Sure! Connect an AI assistant to the atlas from the connect page, then point your client at it.", fire: false, note: "features answer" },
  { text: "Yes — filter a report by typing in its search box, and the row count updates as you type.", fire: false, note: "features answer" },
  { text: "Preview lets you view proposed atlas edits as a redlined atlas before they are merged.", fire: false, note: "features answer" },
  { text: "I can search and read atlas documents, walk the extracted graph, and answer from document history.", fire: false, note: "features answer (chat half)" },

  // ── Negatives: clarifying questions ──────────────────────────────────────
  { text: "Which primitive did you mean — the one in the Stability Scope, or the Accessibility one?", fire: false, note: "clarifying" },
  { text: "Could you say which agent you are asking about? Several hold that role.", fire: false, note: "clarifying" },
  { text: "Do you want the current value, or how it has changed over time?", fire: false, note: "clarifying" },
  // Clarifications wearing an announcement idiom — the one edge the regexes
  // would otherwise take, since /hold on/ and /one moment/ do not care what
  // follows them.
  { text: "Hold on — did you mean the Stability Scope, or the Accessibility one?", fire: false, note: "clarifying (regex idiom)" },
  { text: "One moment: before I look, should I include the history as well?", fire: false, note: "clarifying (regex idiom)" },

  // ── Negatives: honest gaps and scope refusals ───────────────────────────
  { text: "The atlas does not appear to cover that, and I could not find a document naming it.", fire: false, note: "gap" },
  { text: "I searched for that term and found no matching documents in the atlas.", fire: false, note: "gap" },
  { text: "I only answer from the Sky Atlas, so that falls outside what I can cover.", fire: false, note: "refusal" },
  { text: "I cannot change anything — not the atlas, not your collections, not on-chain state.", fire: false, note: "refusal" },
  { text: "That is a settlement figure, which comes from published workbooks rather than the atlas itself.", fire: false, note: "refusal" },

  // ── Negatives: greetings and courtesies (real dev-DB rows) ──────────────
  { text: "Good morning! How can I help you with the Sky Atlas today?", fire: false, note: "real dev-DB row" },
  {
    text: "Hello! I'm the Sky Atlas assistant. I'm here to help you navigate the Sky ecosystem's governance research.\n\nHow can I help you with the atlas today?",
    fire: false,
    note: "real dev-DB row",
  },
  { text: "Hello! I can help you research Sky ecosystem governance using the Atlas. How can I assist you today?", fire: false, note: "real dev-DB row" },
  {
    text: "Not much! Just hanging out in the Sky Atlas, ready to help you navigate the ecosystem's governance.\n\nWhether you need to track down a rule or a role, ask away.",
    fire: false,
    note: "real dev-DB row",
  },
  { text: "You're welcome — glad that helped. Ask away if anything else comes up.", fire: false, note: "courtesy" },
  { text: "I apologize for the inaccuracy. I previously described a relationship without verifying it against the atlas.", fire: false, note: "real dev-DB row (correction)" },
];

// Generated negatives: short, link-free, digit-free answers built from REAL
// atlas subjects. This is the population the lane is most likely to damage —
// a follow-up answered from earlier evidence, or a one-line statement about a
// named thing — and it is generated rather than hand-written so the margin is
// not fitted to a dozen sentences somebody wrote while thinking about the
// positives. Mirrors eval-facts-queries.ts's `atlasNegatives`.
const ANSWER_TEMPLATES: ((s: string) => string)[] = [
  (s) => `${s} is defined in the atlas, and the document sets out how it operates.`,
  (s) => `That is handled by ${s}, according to the atlas.`,
  (s) => `The atlas describes ${s} as part of the scope's structure.`,
  (s) => `Yes — ${s} is what the atlas names for that purpose.`,
  (s) => `${s} carries that responsibility, and no other party shares it.`,
  (s) => `Under the atlas, ${s} must act before the process can continue.`,
  (s) => `In short, ${s} is the governing document for this.`,
  (s) => `No, ${s} does not appear to cover that case.`,
];

const stride = <T,>(xs: T[], n: number): T[] => {
  if (xs.length <= n) return xs;
  const step = xs.length / n;
  return Array.from({ length: n }, (_, i) => xs[Math.floor(i * step)]!);
};

export function generatedAnswerNegatives(subjects: string[], perTemplate = 10): AnnounceCase[] {
  const picked = stride(subjects, perTemplate * ANSWER_TEMPLATES.length);
  return picked.map((subject, i) => ({
    text: ANSWER_TEMPLATES[i % ANSWER_TEMPLATES.length]!(subject),
    fire: false,
    note: "generated answer",
  }));
}
