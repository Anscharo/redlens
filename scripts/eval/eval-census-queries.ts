// Labeled routing set for the census bakeoff (eval-census.ts): given a
// question, which concept-census slug (src/lib/conceptsCensus.ts) — if any —
// should the concepts-prefetch lane inject?
//
// Unlike eval-skills-queries.ts's fire/no-fire cases, positives here carry an
// EXPECTED SLUG: routing (1-of-10, take up to 3) is a different failure shape
// than a single skill's binary trigger, and "the wrong census fired" is its
// own error distinct from "no census fired". Every positive question below is
// a paraphrase — deliberately NOT the sentence used as a production prototype
// (CENSUS_PROTOTYPES in eval-census.ts) — so the measurement tests
// generalization, not string-recall.
import type { CensusSlug } from "../../src/lib/conceptsCensus.ts";
import { atlasNegatives } from "./eval-skills-queries.ts";

export interface CensusCase {
  q: string;
  /** Expected census slug, or null when no census should fire at all. */
  expectSlug: CensusSlug | null;
  note?: string;
}

export const CENSUS_TRIGGER_CASES: CensusCase[] = [
  // ── registry-liveness ──────────────────────────────────────────────────
  { q: "are there registries with nothing in them?", expectSlug: "registry-liveness", note: "regex HIT — literal 'registries'" },
  { q: "which lists in the atlas are still empty?", expectSlug: "registry-liveness", note: "regex MISS — no 'registr' token" },
  { q: "how many 'list of' pages actually have entries?", expectSlug: "registry-liveness" },
  { q: "do we have any completely unpopulated registries?", expectSlug: "registry-liveness" },
  { q: "which catalog pages never got filled in?", expectSlug: "registry-liveness" },

  // ── ghost-doc-types ─────────────────────────────────────────────────────
  { q: "which document types in the spec were never actually created?", expectSlug: "ghost-doc-types" },
  { q: "what types does the type registry name that don't appear anywhere?", expectSlug: "ghost-doc-types" },
  { q: "are there any document types that exist on paper only?", expectSlug: "ghost-doc-types" },
  { q: "which planned types have zero real documents?", expectSlug: "ghost-doc-types" },
  { q: "what's in the type catalog but missing from the corpus?", expectSlug: "ghost-doc-types" },

  // ── cross-scope-duplication ─────────────────────────────────────────────
  { q: "do any two scopes describe the exact same concept separately?", expectSlug: "cross-scope-duplication" },
  { q: "which document titles show up more than once across different scopes?", expectSlug: "cross-scope-duplication" },
  { q: "are there duplicate write-ups of the same idea in different sections?", expectSlug: "cross-scope-duplication" },
  { q: "which concepts got written up twice, once per scope?", expectSlug: "cross-scope-duplication" },
  { q: "is there any redundant documentation spread across scopes?", expectSlug: "cross-scope-duplication" },

  // ── transitionary-measures ──────────────────────────────────────────────
  { q: "which rules are only meant to apply temporarily?", expectSlug: "transitionary-measures" },
  { q: "what stopgap provisions exist before a permanent rule replaces them?", expectSlug: "transitionary-measures" },
  { q: "are there any interim measures called out in the atlas?", expectSlug: "transitionary-measures" },
  { q: "which sections describe a bridge arrangement until something else is ready?", expectSlug: "transitionary-measures" },
  { q: "what temporary fixes does the atlas document?", expectSlug: "transitionary-measures" },

  // ── formula-docs ─────────────────────────────────────────────────────────
  { q: "where does the atlas do math?", expectSlug: "formula-docs", note: "regex MISS — no 'formula'/'equation' token" },
  { q: "which documents include a mathematical formula?", expectSlug: "formula-docs" },
  { q: "where are equations actually written out?", expectSlug: "formula-docs" },
  { q: "which sections have calculations in them?", expectSlug: "formula-docs" },
  { q: "does the atlas define any formal computations?", expectSlug: "formula-docs" },

  // ── prohibition-language ────────────────────────────────────────────────
  { q: "what is banned?", expectSlug: "prohibition-language", note: "regex MISS — no 'prohibit' token" },
  { q: "which rules say something is forbidden?", expectSlug: "prohibition-language" },
  { q: "where does the atlas say an action may not be taken?", expectSlug: "prohibition-language" },
  { q: "what's explicitly disallowed by the rules?", expectSlug: "prohibition-language" },
  { q: "which documents use prohibition language?", expectSlug: "prohibition-language", note: "regex HIT — literal 'prohibition'" },

  // ── empty-scaffolding ────────────────────────────────────────────────────
  { q: "which sections are just placeholders?", expectSlug: "empty-scaffolding", note: "regex MISS — no 'scaffold' token" },
  { q: "are there status folders with nothing in them yet?", expectSlug: "empty-scaffolding" },
  { q: "which lifecycle buckets are still totally empty?", expectSlug: "empty-scaffolding" },
  { q: "what parts of the primitive structure are unused scaffolding?", expectSlug: "empty-scaffolding", note: "regex HIT — literal 'scaffolding'" },
  { q: "are any of the instance directories completely bare?", expectSlug: "empty-scaffolding" },

  // ── numbered-step-docs ───────────────────────────────────────────────────
  { q: "which documents spell out a numbered procedure?", expectSlug: "numbered-step-docs" },
  { q: "where does the atlas give step-by-step instructions?", expectSlug: "numbered-step-docs", note: "regex HIT — literal 'step-by-step'" },
  { q: "which sections read like a numbered checklist?", expectSlug: "numbered-step-docs" },
  { q: "are there any docs written as an ordered sequence of steps?", expectSlug: "numbered-step-docs" },
  { q: "which write-ups number their steps 1, 2, 3?", expectSlug: "numbered-step-docs" },

  // ── title-templates ──────────────────────────────────────────────────────
  { q: "which documents reuse the exact same title over and over?", expectSlug: "title-templates" },
  { q: "are there boilerplate document titles used across many places?", expectSlug: "title-templates" },
  { q: "what recurring title patterns show up in the atlas?", expectSlug: "title-templates" },
  { q: "which docs share an identical templated name?", expectSlug: "title-templates", note: "regex HIT — literal 'templated'" },
  { q: "is there a standard title format repeated across sections?", expectSlug: "title-templates" },

  // ── normative-title-families ────────────────────────────────────────────
  { q: "which documents belong to a family of normative rules?", expectSlug: "normative-title-families", note: "regex HIT — literal 'normative'" },
  { q: "what groups of rules share a common normative theme?", expectSlug: "normative-title-families", note: "regex HIT — literal 'normative'" },
  { q: "are there clusters of documents named after the same kind of rule?", expectSlug: "normative-title-families" },
  { q: "which titles fall under things like prohibition, suspension, or derecognition?", expectSlug: "normative-title-families" },
  { q: "what rule categories does the atlas organize documents into?", expectSlug: "normative-title-families" },
];

// Explicit hard negatives — small talk, and the exact regression cases pinned
// in skills/registry.test.ts ("does not fire the census lane on ordinary
// doc-lookup phrasing"). "list of prime agents" is the sharpest adversarial
// case for registry-liveness specifically: it wears the census's own title
// prefix while being a plain roster lookup, not a liveness question.
const EXPLICIT_NEGATIVES: CensusCase[] = [
  { q: "list of prime agents", expectSlug: null, note: "doc-lookup wearing registry-liveness vocabulary — registry.test.ts regression case" },
  { q: "what is universal alignment?", expectSlug: null, note: "registry.test.ts regression case" },
  { q: "who is keel?", expectSlug: null, note: "registry.test.ts regression case" },
  { q: "hi", expectSlug: null },
  { q: "thanks, that helped", expectSlug: null },
  { q: "good morning", expectSlug: null },
  { q: "what reports must the facilitator file?", expectSlug: null, note: "'reports' borrows census-sounding vocabulary but names a specific role" },
  { q: "how do i export a csv from reports?", expectSlug: null, note: "product question, not atlas" },
];

// The negative pool the task calls for: real atlas-templated "specific
// document lookup" questions (what is X / where is X defined / who is
// responsible for X), generated from real titles/entities so the pool is
// large and not tuned to whatever a hand-written set happens to avoid — same
// generator eval-skills.ts uses for its hard negatives.
export function censusNegatives(subjects: string[]): CensusCase[] {
  return [
    ...EXPLICIT_NEGATIVES,
    ...atlasNegatives(subjects).map((c): CensusCase => ({ q: c.q, expectSlug: null, note: c.note })),
  ];
}
