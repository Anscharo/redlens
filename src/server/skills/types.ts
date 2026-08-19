// The skill contract. A "skill" is a block of context injected into a chat turn
// only when the turn calls for it — the generalization of what were three
// hand-wired prefetch lanes (glossary / entity / concept census). Each skill
// decides for itself whether it fires, and returns the rows the model should
// read plus the note that says how to handle them.
//
// Skills are DETERMINISTIC and cheap: pure code, no LLM call, no network. That
// is what makes an always-on registry affordable — a miss costs microseconds
// and injects nothing. Anything that needs a model call is a tool, not a skill.
import type { Indexes } from "../retrieval/indexes.ts";
import type { PageContext } from "../chat/system-prompt.ts";

export interface SkillContext {
  ix: Indexes;
  /** The user's message for THIS turn — the main trigger signal. */
  question: string;
  /** Where the user is in the app, when the client sent it. */
  page?: PageContext;
}

export interface SkillBlock {
  /** JSON key this block lands under in the injected tool result. */
  key: string;
  /** What the model reads under that key. */
  value: unknown;
  /** Handling/attribution rules, injected alongside as `<key>_note`. */
  note?: string;
  /** Rows found. Zero means the skill did not fire — nothing is injected. */
  count: number;
}

export interface Skill {
  /** Stable id — the telemetry key, and how a skill is named in review. */
  id: string;
  /** One line for humans: what this skill knows, and when it fires. */
  what: string;
  /** Returns null (or a zero count) when the turn doesn't call for it. */
  run(ctx: SkillContext): SkillBlock | null;
}
