// The exact Jev question wording for the pre-first-token prefetch judge
// (prefetch-judge.ts). Split into its own module because the judge plus this
// wording exceeded the ~150-line file convention together, and because the
// wording itself is LOAD-BEARING: every threshold prefetch-judge.ts exports
// was measured (docs/plans/jev-typesafe.md, "Research round 2026-09-22 —
// prefetch gating") against exactly this text, over exactly this shape of
// request. Changing a word here without re-running the bakeoff invalidates
// the thresholds that cite it.
import { type CensusSlug, CENSUS_SLUGS } from "../../lib/conceptsCensus.ts";
import type { JevQuestion } from "../jev.ts";

const ATLAS_FRAME =
  "The message in `message` was sent to the chat assistant of a research app for the Sky ecosystem's governance atlas, a corpus of thousands of governance documents.";

// The same question that decides the STRONG tier's on-device similarity lane
// (complexity.ts's COMPLEXITY_PROTOTYPES), asked of Jev instead — see
// model-router.ts for how the two are combined (OR, never a replacement: a
// miss here still has the embedding lane as a backstop).
export const PREFETCH_COMPLEXITY_QUESTION: JevQuestion = {
  type: "noul",
  instructions: `${ATLAS_FRAME} Would a complete answer have to gather or combine information from many documents across the atlas, rather than from one named subject?`,
  criteria: {
    true: "The message asks for a whole set of things across the atlas (every item of some kind, a roster, a breakdown or tally by category, a census), or for an overview or synthesis drawn from the atlas broadly (patterns across documents, how the atlas is organized overall, activity across it).",
    false: "The message is about one named subject — a single document, scope, agent, accord, module, role, process or parameter — even when it uses summary or listing words about that one subject. Greetings, thanks and questions about the app itself are also false.",
  },
};

// Shared false-criterion for every census question below: the competing class
// is a specific-document lookup — the same distinction concepts-prefetch.ts's
// CENSUS_NEGATIVE_PROTOTYPES draws for the embedding lane, worded for a model
// that reads criteria literally rather than scored against prototypes.
const CENSUS_FALSE =
  "A question about one specific named document, agent, scope, role, process or parameter; a request for what one particular list or registry contains; greetings and thanks; questions about the app.";

function censusQuestion(asks: string, trueText: string): JevQuestion {
  return {
    type: "noul",
    instructions: `${ATLAS_FRAME} Is it asking, across the atlas as a whole, ${asks}?`,
    criteria: { true: trueText, false: CENSUS_FALSE },
  };
}

// One Noul per census slug — keyed by the slug itself (askJev's `questions`
// ids are for code only, never shown to the model, so there is no reason to
// prefix them the way the transcript-facing payload does).
export const PREFETCH_CENSUS_QUESTIONS: Record<CensusSlug, JevQuestion> = {
  "registry-liveness": censusQuestion(
    "which registries or \"List of …\" catalog documents actually have entries and which are empty",
    "Asks which lists, registries or catalog pages in the atlas are populated versus empty, unused or abandoned.",
  ),
  "ghost-doc-types": censusQuestion(
    "which document types defined in the atlas's type specifications have no real documents of that type",
    "Asks about document types that are specified, planned or registered but never used by any actual document.",
  ),
  "cross-scope-duplication": censusQuestion(
    "whether the same concept or document title is written up separately in two or more different scopes",
    "Asks about duplicated, parallel or redundant write-ups of one concept or title across different scopes or sections.",
  ),
  "transitionary-measures": censusQuestion(
    "which provisions are temporary or transitional, meant to apply only until a permanent arrangement replaces them",
    "Asks about interim, stopgap, short-term or transitional rules and arrangements.",
  ),
  "formula-docs": censusQuestion(
    "which documents contain mathematical formulas, equations or calculations",
    "Asks where the atlas uses math: formulas, equations, calculations or mathematical notation.",
  ),
  "prohibition-language": censusQuestion(
    "which rules prohibit or forbid actions — what is not permitted",
    "Asks what actions the atlas bans, forbids, disallows or says may not be taken.",
  ),
  "empty-scaffolding": censusQuestion(
    "which structural placeholder sections — such as Active, Suspended or Completed instance status directories — are empty",
    "Asks about empty placeholder sections, empty status or lifecycle directories, or unused structural scaffolding.",
  ),
  "numbered-step-docs": censusQuestion(
    "which documents are written as numbered, step-by-step procedures",
    "Asks about documents laid out as ordered, numbered steps, procedures or checklists.",
  ),
  "title-templates": censusQuestion(
    "which exact document titles are reused as a standard template in many places",
    "Asks about recurring, boilerplate or templated document titles that repeat across the atlas.",
  ),
  "normative-title-families": censusQuestion(
    "how documents group into families of normative rules by title theme, such as prohibition, derecognition, suspension, adjudication, alignment or edit restrictions",
    "Asks about categories, families or clusters of normative rules grouped by the kind of rule their titles name.",
  ),
};

// Drift guard: a census slug added to CENSUS_SLUGS without a matching
// question here would silently never fire through Jev — asserted in
// prefetch-judge.test.ts rather than trusted by inspection.
export function everySlugHasAQuestion(): boolean {
  return CENSUS_SLUGS.every((s) => s in PREFETCH_CENSUS_QUESTIONS);
}

// The per-note "bookQ" form: one Noul per note, addressed by its index into
// the SAME `notes` array the caller puts in state — prefetch-judge.ts keeps
// the two in lockstep so index i here always means notes[i] there.
const TEACH_FRAME =
  "A user of a research assistant for the Sky ecosystem's governance atlas saved private notes earlier. They have now sent `message`.";
const TEACH_CRITERIA = {
  true: "The note bears directly on what the message asks: it defines a term, alias or abbreviation the message uses, says where to find the thing asked about, states a fact the message asks for, or gives an instruction for this kind of question.",
  false: "The note is about something else. Sharing a name, agent or topic word with the message is not enough when the note does not bear on what is asked.",
};

export function teachBookQuestion(i: number): JevQuestion {
  return {
    type: "noul",
    instructions: `${TEACH_FRAME} Would the note \`notes[${i}]\` help the assistant answer this message?`,
    criteria: TEACH_CRITERIA,
  };
}
