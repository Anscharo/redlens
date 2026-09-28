// Labeled cases for the small-talk judge bakeoff (eval-smalltalk-judge.ts).
//
// LABELS FOLLOW THE SHIPPED JUDGE SEMANTICS, not intuition about tone:
// smalltalk=true ONLY for pure conversation whose reply needs no factual
// content. The judge's own prompt ends "When unsure: false", so every
// genuinely ambiguous case here is labeled FACTUAL — that is the fail-closed
// direction, and mislabeling it the other way would reward a judge for the
// one error that costs trust.
//
// Two tiers. BASE is the 2026-08-13 set that chose the incumbent; it is
// SATURATED (gemma-4-26b-a4b-it scores 100%, 0 dangerous), so parity on it is
// a floor, not a result. HARD is the discriminator, built from the classes the
// base set has no members of:
//   · single ambiguous words ("updates", "status", "rules")
//   · greeting-shaped questions ("hi?", "hello?")
//   · non-English courtesies, which the base set only has on the factual side
//   · compound turns that open with a courtesy and then ask
//   · capability/meta questions wearing conversational clothes
//   · follow-up shapes ("is that everything?", "so, thoughts?", "what else?")
// Only the message is judged: the deterministic prefilter guarantees nothing
// groundable (a digit, link, doc number…) ever reaches the judge, so every
// case here is marker-free by construction.
//
// The follow-up shapes were once out-of-population — the judge ran on first
// user messages only, so nothing referring to an earlier turn could reach it.
// That gate was removed 2026-09-22 and they are now IN population, which is
// what makes them the most load-bearing cases in this file rather than mere
// classifier stress tests. They must stay well clear of the threshold from
// the words alone; the judgment is deliberately message-only.

export interface JudgeCase {
  q: string;
  /** true = pure small talk (bypass is safe); false = expects factual content. */
  expected: boolean;
  hard: boolean;
}

const BASE_SMALLTALK: string[] = [
  "hello", "Hi there!", "hey", "good morning", "thanks!",
  "thank you so much, that was really helpful", "ok great", "bye",
  "goodbye, have a nice day", "👋", "are you there?", "test",
  "how are you?", "lol", "cool, thanks. you're pretty good at this",
];

const BASE_FACTUAL: string[] = [
  "is the stability fee controlled by governance?", "does sky have a treasury?",
  "who runs the protocol?", "what can you do?", "who are you?", "help",
  "can you summarize the atlas?", "what is a scope?", "tell me about facilitators",
  "how do payments work?", "is there a rewards program?",
  "hey, quick question — who approves budgets?",
  "thanks! also, what is an executor agent?", "yo what's the deal with multisigs",
  "explain governance to me", "are stablecoins risky?", "should I trust this protocol?",
  "what changed recently?", "where can I find the rules about penalties?",
  "do facilitators get paid?", "hola, ¿qué es un scope?",
  "how does this compare to maker?", "give me a quick overview", "what's new?",
  "is the atlas up to date?", "any updates?", "anything interesting happen lately?",
];

// Pure conversation still — no reply here needs a fact. Several are
// greeting-shaped questions, which is the shape most likely to drag a literal
// reader toward "this is a question, so it wants facts".
const HARD_SMALLTALK: string[] = [
  "hi?", "hello?", "you still there?", "ok", "👍", "nice one",
  "sorry, my bad", "never mind", "haha fair enough", "morning :)",
  "appreciate it", "no worries", "bonjour", "danke schön",
  "ok cool talk later", "right, got it", "hey you", "yo",
];

// Conversational clothes, factual expectations. The dangerous class: every one
// of these rules small talk only by reading the tone and ignoring the ask.
const HARD_FACTUAL: string[] = [
  "updates", "status", "rules", "anything I should know?",
  "so what's the story here?", "what else?", "give me the short version",
  "anything important?", "is that everything?", "ok and what about the other one",
  "sup, what does this thing do", "how do I use you?", "are you up to date?",
  "who made you?", "what's the point of this?",
  "quick sanity check — does that sound right?",
  "hey, can you help me with something?", "test the atlas",
  "morning! anything happen overnight?", "bonjour, comment ça marche?",
  "thanks — one more thing about the budget process",
  "hey, is that actually true?", "so, thoughts?", "what do you know?",
];

export const CASES: JudgeCase[] = [
  ...BASE_SMALLTALK.map((q) => ({ q, expected: true, hard: false })),
  ...BASE_FACTUAL.map((q) => ({ q, expected: false, hard: false })),
  ...HARD_SMALLTALK.map((q) => ({ q, expected: true, hard: true })),
  ...HARD_FACTUAL.map((q) => ({ q, expected: false, hard: true })),
];
