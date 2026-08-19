// Labeled trigger set for the skills bakeoff (eval-skills.ts): does a question
// call for the app-documentation skill (src/server/skills/features.ts)?
//
// The set is built around the failure that matters. A false fire injects ~8KB
// of product documentation into an ATLAS question and steers the answer toward
// the app; a miss just means the model answers about the app from a system
// prompt that doesn't describe it. So false positives are far worse than false
// negatives, and the negatives here are deliberately adversarial: governance
// questions that borrow the product question's exact shape ("what can the Spark
// agent do") or its exact nouns ("what reports must the facilitator file").
export interface TriggerCase {
  q: string;
  /** Ground truth: should the app-documentation skill fire? */
  fire: boolean;
  /** Why this case is in the set — printed next to any disagreement. */
  note?: string;
}

export const TRIGGER_CASES: TriggerCase[] = [
  // ── Positives the current regex already catches ────────────────────────
  { q: "what can i do with redline sky atlas?", fire: true },
  { q: "what capabilities exist?", fire: true },
  { q: "tell me about the features of the app", fire: true },
  { q: "what can you do?", fire: true },
  { q: "what is redlens?", fire: true },
  { q: "how do i get started with the app?", fire: true },
  { q: "what are you capable of?", fire: true },
  { q: "how do i export a csv from reports?", fire: true },
  { q: "can i download the multisig table?", fire: true },
  { q: "where is the keyboard shortcut list?", fire: true },

  // ── Positives the regex MISSES — the whole reason to consider embeddings ──
  { q: "give me a tour", fire: true, note: "no capability noun, no app noun" },
  { q: "show me around", fire: true, note: "idiomatic onboarding ask" },
  { q: "i'm new here, where do i start?", fire: true, note: "'here' but no artifact" },
  { q: "what should i try first?", fire: true, note: "onboarding, zero trigger vocabulary" },
  { q: "whats possible with this thing", fire: true, note: "typo + vague demonstrative" },
  { q: "does this thing do exports?", fire: true, note: "artifact noun, not a how/where shape" },
  { q: "is there a way to save documents i care about?", fire: true, note: "describes collections without naming them" },
  { q: "list everything you support", fire: true, note: "imperative, not a question shape" },
  { q: "any way to hook this up to claude code?", fire: true, note: "MCP, phrased as slang" },
  { q: "tell me about yourself", fire: true, note: "chat-capabilities half" },

  // ── More positives, by phrasing family. Hand-written: there is no corpus of
  //    real product questions to sample, and the families are the point —
  //    onboarding, capability, per-area how-to, chat-vs-app, slang/typo.
  //    Onboarding
  { q: "how does this site work?", fire: true },
  { q: "what am i looking at?", fire: true },
  { q: "walk me through what's here", fire: true },
  { q: "first time here — what now?", fire: true },
  { q: "is there a guide?", fire: true },
  { q: "what should i know before i start?", fire: true },
  { q: "im asking about this website", fire: true, note: "verbatim from real traffic" },
  //    Capability, various shapes
  { q: "what all can this do?", fire: true },
  { q: "what are the main things this app offers?", fire: true },
  { q: "anything else this can do?", fire: true },
  { q: "what's this tool for?", fire: true },
  { q: "why would i use this instead of reading the atlas directly?", fire: true },
  { q: "what makes this different from the atlas repo?", fire: true },
  //    Per-area how-to
  { q: "how do i search for a document?", fire: true },
  { q: "how do i filter a report?", fire: true },
  { q: "can i save a set of documents?", fire: true },
  { q: "how do i share a link to a specific document?", fire: true },
  { q: "is there a dark mode?", fire: true },
  { q: "how do i see what changed recently in the app?", fire: true },
  { q: "can i preview a pull request against the atlas?", fire: true },
  { q: "how do i connect cursor to this?", fire: true },
  { q: "what keyboard shortcuts are there?", fire: true },
  { q: "how do i copy a document's link?", fire: true },
  { q: "where do i find the entity map?", fire: true },
  { q: "can i download data as a spreadsheet?", fire: true },
  //    Chat-capabilities half
  { q: "what kind of questions can i ask you?", fire: true },
  { q: "can you edit the atlas?", fire: true },
  { q: "are you able to browse the web?", fire: true },
  { q: "how do you know any of this?", fire: true },
  { q: "what are your limits?", fire: true },
  { q: "can you export what you found?", fire: true },
  //    Slang, typos, terse
  { q: "wat can u do", fire: true },
  { q: "features?", fire: true },
  { q: "capabilities", fire: true },
  { q: "help", fire: true },
  { q: "what else you got", fire: true },
  { q: "show me the reports pls", fire: true },

  // ── Hard negatives: atlas questions wearing the product question's shape ──
  { q: "what are the features of the Stability Scope?", fire: false, note: "capability noun, atlas subject" },
  { q: "what can the Spark agent do?", fire: false, note: "EXACT 'what can X do' shape, atlas subject" },
  { q: "what capabilities does the Executor Agent have?", fire: false, note: "capability noun, atlas subject" },
  { q: "what reports must the facilitator file?", fire: false, note: "'reports' is an app noun AND a governance noun" },
  { q: "can i become a delegate?", fire: false, note: "'can i' shape, governance object" },
  { q: "what can a facilitator do about a breach?", fire: false, note: "'what can X do' + governance" },
  { q: "how do i find the stability rate?", fire: false, note: "how-to shape, atlas object" },
  { q: "where is the Keel Accord defined?", fire: false, note: "where-is shape, atlas object" },
  { q: "what is the ALM Rental Primitive?", fire: false, note: "'what is X' shape, atlas subject" },
  { q: "what does the atlas say about rewards?", fire: false },
  { q: "who is keel?", fire: false },
  { q: "list every prime agent", fire: false, note: "imperative list, atlas object" },
  { q: "how many registries are empty?", fire: false, note: "census lane, not the features lane" },
  { q: "what changed in the last month?", fire: false, note: "history question" },
  { q: "hello", fire: false },
  { q: "thanks, that helped", fire: false },
  { q: "what is universal alignment?", fire: false },
  { q: "which multisigs hold SKY?", fire: false },
  { q: "summarize the governance process for onboarding a new agent", fire: false },
  { q: "what are the requirements to become a facilitator?", fire: false, note: "'requirements' ≈ capabilities" },

  // ── Small talk: the class that sits nearest the decision boundary. Not a
  //    product question — the answer is a greeting, not the features guide.
  { q: "hi", fire: false },
  { q: "hey there", fire: false },
  { q: "good morning", fire: false },
  { q: "thanks!", fire: false },
  { q: "thank you, very helpful", fire: false },
  { q: "ok cool", fire: false },
  { q: "nice", fire: false },
  { q: "bye", fire: false },
  { q: "who are you talking to", fire: false },
  { q: "are you there?", fire: false },

  // ── More governance negatives, hand-written to borrow product vocabulary ──
  { q: "what tools does the facilitator have to enforce this?", fire: false, note: "'tools' is an app word" },
  { q: "can i see the reward parameters?", fire: false, note: "'can i see' + atlas object" },
  { q: "how do i qualify as an integrator?", fire: false },
  { q: "where do i submit a governance proposal?", fire: false, note: "'where do i' + governance" },
  { q: "what does the accessibility scope cover?", fire: false },
  { q: "is there a way to appeal a decision?", fire: false, note: "same 'is there a way' shape as a real positive" },
  { q: "what can be exported from the treasury?", fire: false, note: "'exported' in a governance sense" },
  { q: "show me the multisig addresses", fire: false, note: "'show me' + atlas object" },
  { q: "what are the search costs in the alignment budget?", fire: false, note: "'search' as an atlas term" },
  { q: "list the collections held by the foundation", fire: false, note: "'collections' is an app noun too" },
];

// Governance questions built from real atlas titles and entity names, in the
// shapes most likely to be mistaken for product questions ("what can X do",
// "what are the features of X"). Generated rather than hand-written so the
// negative set is large, realistic, and not tuned to whatever the model
// happens to get right. Stride-sampled, not sliced — see the note in
// eval-retrieval-queries.ts about clustered samples buying less evidence.
const ATLAS_TEMPLATES: ((subject: string) => string)[] = [
  (s) => `what can ${s} do?`,
  (s) => `what capabilities does ${s} have?`,
  (s) => `what are the features of ${s}?`,
  (s) => `how do i find ${s}?`,
  (s) => `where is ${s} defined?`,
  (s) => `what is ${s}?`,
  (s) => `who is responsible for ${s}?`,
  (s) => `what reports does ${s} file?`,
  (s) => `can i see the parameters for ${s}?`,
  (s) => `what changed in ${s} recently?`,
  (s) => `is there a way to change ${s}?`,
  (s) => `show me everything about ${s}`,
];

function stride<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const step = items.length / n;
  return Array.from({ length: n }, (_, i) => items[Math.floor(i * step)]!);
}

export function atlasNegatives(subjects: string[], perTemplate = 12): TriggerCase[] {
  const picked = stride(subjects, perTemplate * ATLAS_TEMPLATES.length);
  return picked.map((subject, i) => ({
    q: ATLAS_TEMPLATES[i % ATLAS_TEMPLATES.length]!(subject),
    fire: false,
    note: "generated from atlas",
  }));
}
