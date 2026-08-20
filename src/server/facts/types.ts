// The fact contract. A "fact" is a block of knowledge injected into a chat
// turn only when the turn calls for it — the generalization of what were three
// hand-wired prefetch lanes (glossary / entity / concept census). Each fact
// source decides for itself whether it fires, and returns the rows the model
// should read plus the note that says how to handle them.
//
// Facts are DETERMINISTIC and cheap: pure code, no LLM call, no network. That
// is what makes an always-on registry affordable — a miss costs microseconds
// and injects nothing. Anything that needs a model call is a tool, not a fact.
import type { Indexes } from "../retrieval/indexes.ts";
import type { PageContext } from "../chat/system-prompt.ts";

export interface FactContext {
  ix: Indexes;
  /** The user's message for THIS turn — the main trigger signal. */
  question: string;
  /** Where the user is in the app, when the client sent it. */
  page?: PageContext;
  /**
   * The registry's similarity lane matched this fact's `prototypes` — the
   * question looks like one this fact answers even though its deterministic
   * trigger missed. A fact may still decline; it is a signal, not an order.
   */
  semanticHit?: boolean;
}

export interface FactBlock {
  /** JSON key this block lands under in the injected tool result. */
  key: string;
  /** What the model reads under that key. */
  value: unknown;
  /** Handling/attribution rules, injected alongside as `<key>_note`. */
  note?: string;
  /** Rows found. Zero means the fact did not fire — nothing is injected. */
  count: number;
}

export interface Fact {
  /** Stable id — the telemetry key, and how a fact is named in review. */
  id: string;
  /** One line for humans: what this fact knows, and when it fires. */
  what: string;
  /**
   * User-facing phrase for what it just contributed ("2 glossary definitions").
   * Injected knowledge used to be silent work that shaped the answer, so the
   * chat says which facts ran — this is that copy, owned by the fact rather
   * than the UI. The verb in the ticker is "Recalled".
   */
  summarize(count: number): string;
  /**
   * Example questions this fact answers. When present, the registry also
   * scores the turn against them (facts/similarity.ts) and sets
   * `semanticHit`, so a fact can fire on phrasing its own trigger never
   * anticipated. Omit for lanes where the match IS the extraction — the
   * glossary and entity facts have to know WHICH term or entity to inject,
   * which a similarity score cannot tell them.
   */
  prototypes?: string[];
  /** Returns null (or a zero count) when the turn doesn't call for it. */
  run(ctx: FactContext): FactBlock | null;
}
