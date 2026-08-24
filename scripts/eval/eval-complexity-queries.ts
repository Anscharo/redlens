// Labeled corpus for the tier router's similarity lane (src/server/chat/complexity.ts).
//
// The set is built around the failure that matters, and it is the OPPOSITE
// asymmetry from eval-facts. A false fire here routes an easy question to a
// model the 2026-08-21 bakeoff showed is both better and faster — it costs
// tokens, never correctness. A miss leaves a whole-corpus question with the
// model measured at 0.70 completeness on exactly that class. So recall is
// weighted heavily, and the negatives exist to stop the lane firing on
// EVERYTHING rather than to drive false fires to zero.
//
// Every positive is phrased to avoid every STRONG regex trigger in
// model-router.ts. That is the whole point: it measures what the embedding
// adds beyond the regexes, which score 0 on this set.
export interface ComplexityCase {
  q: string;
  fire: boolean;
  note?: string;
}

export const COMPLEXITY_CASES: ComplexityCase[] = [
  // ── Whole-corpus enumeration ──────────────────────────────────────────────
  { q: "which agents hold a facilitator role", fire: true },
  { q: "give me a rundown of the multisigs in the atlas", fire: true },
  { q: "what registries exist and how full are they", fire: true },
  { q: "i need a breakdown of documents by type", fire: true },
  { q: "show me the spread of parameters across scopes", fire: true },
  { q: "who signs on the various multisigs", fire: true },
  { q: "what roles has the atlas defined so far", fire: true },
  { q: "walk me through the full set of integration partners", fire: true },
  { q: "map out the entities the atlas recognizes", fire: true },
  { q: "give me the complete picture of token transfers", fire: true },
  { q: "catalog the documents that define formulas", fire: true },
  { q: "round up the addresses referenced across the atlas", fire: true },
  { q: "what kinds of documents does the atlas use and how many of each", fire: true },
  { q: "collect the parameters that control stability fees", fire: true },
  { q: "break down the atlas by scope and show me the sizes", fire: true },
  { q: "give me a census of empty registries", fire: true },
  { q: "across the whole atlas, where does math show up", fire: true },
  { q: "assemble a list of facilitator responsibilities", fire: true },
  { q: "what's the landscape of agents and their statuses", fire: true },
  { q: "run down the scopes and tell me which are populated", fire: true },

  // ── Whole-corpus synthesis ────────────────────────────────────────────────
  { q: "put together a summary of recent atlas activity", fire: true },
  { q: "i want an overview of everything the atlas says about rewards", fire: true },
  { q: "summarize the atlas's coverage of governance processes", fire: true },
  { q: "produce a digest of what changed this quarter", fire: true },
  { q: "what patterns do you see across the atlas documents", fire: true },
  { q: "i'd like a survey of the atlas's normative language", fire: true },
  { q: "give me the big picture of how the atlas is organized", fire: true },
  { q: "what is the overall shape of the atlas's rule families", fire: true },

  // ── Hard negatives: ONE subject, enumerative-sounding words ───────────────
  { q: "give me a rundown of the Keel Accord", fire: false, note: "single subject, enumerative verb" },
  { q: "summarize the Stability Scope for me", fire: false },
  { q: "what's the complete picture on A.2.7.1", fire: false, note: "single subject, 'complete picture'" },
  { q: "walk me through this one document", fire: false },
  { q: "break down the Emergency Shutdown Module", fire: false },
  { q: "map out how this single process works", fire: false, note: "single subject, 'map out'" },
  { q: "i want an overview of the Accessibility Scope", fire: false },
  { q: "collect the parameters for the SkyLink multisig", fire: false },
];
