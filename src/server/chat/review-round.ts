// A synthetic tool round that hands the model what the USER CAN SEE under its
// own earlier answers: the verification badge and its findings, the agreed
// contradictions, the answer-coverage line, and the Sources chips that are not a
// plain ✓ (verify/review-note.ts builds one note per answer from the stored
// message_checks rows).
//
// Without it the model is answering about a screen it cannot see. The chat
// replays the whole thread but only four columns of it (chat.ts's history
// SELECT), so "why was verification failed?" has nothing to reason from.
// Observed in a real transcript: that question produced three guesses and a
// clarifying question, and only became a correct answer after the user pasted the
// failure text in by hand.
//
// This generalizes the dispute round it replaces, which carried the newest
// answer's agreed contradictions and nothing else. Its framing and its caveats
// are kept verbatim, because they were the hard-won part.
//
// It rides its OWN tool round (mirrors facts/registry.ts's factRound and
// teach/inject.ts's teachingRound) rather than being appended onto the prior
// assistant message's `content`, for three reasons:
//   - the model reads its own `content` as its own prior prose — an appended
//     verifier note would look like something it said, not context handed to
//     it from outside;
//   - verifier.ts's priorTurnsEvidence treats assistant content as evidence, so
//     a note baked into content would become grounding for the answer it audits;
//   - title.ts's transcript builder reads assistant `content` verbatim to
//     title the conversation — a note baked into content would leak into a
//     conversation title.
//
// One round for the WHOLE ledger, not one per answer: a per-row round would need
// a persisted synthetic id (the cross-turn problem tool-recall.ts's `rcall…`
// comment avoids), would double the message count, and would grow linearly with
// the thread. This is O(1) in thread length.
import type OpenAI from "openai";
import type { AgreedContradiction } from "./verify/disputes.ts";
import type { ReviewNote } from "./verify/review-note.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export const REVIEW_TOOL_NAME = "atlas_review_notes";
export const REVIEW_TOOL_ID = "call_review_notes";

/**
 * True for this round's tool name OR its call id, so every consumer that must
 * not treat it as evidence can ask one question. Four sites need it and only two
 * excluded the dispute round it replaces — see the call sites.
 */
export function isReviewRound(toolNameOrId: string | undefined): boolean {
  return toolNameOrId === REVIEW_TOOL_NAME || toolNameOrId === REVIEW_TOOL_ID;
}

/** How many of the newest assistant answers can appear at all. */
export const REVIEW_LOOKBACK = 12;
/** Whole tool message. Digest lines are dropped oldest-first to fit. */
export const REVIEW_ROUND_MAX_CHARS = 8000;
/** The newest answer's block, which always fits. */
export const NEWEST_BLOCK_MAX_CHARS = 5000;
/** One older answer's one-line digest. */
export const DIGEST_MAX_CHARS = 240;
/** Agreed contradictions shown, newest answer only. */
export const MAX_DISPUTES = 3;

// Long spans (a whole paragraph quoted as `answer`/`evidence`, or a verbose
// `why`) are capped so one long-winded flag cannot blow up the round's token
// cost. 300 chars comfortably holds a sentence or two — the unit these spans
// are always drawn at (refute.ts operates per-sentence/paragraph).
const MAX_SPAN_CHARS = 300;

// Span truncation, inherited verbatim from the dispute round: n characters of
// content PLUS the ellipsis, so a capped span is n+1 long. Kept as-is because the
// spans are quoted text and 300 is about "a sentence or two of content".
function truncate(s: string, n = MAX_SPAN_CHARS): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// A real ceiling: at most n characters INCLUDING the ellipsis. The budget
// arithmetic below sums these, so a cap that overshot by one per line would make
// the total cap a lie.
function clipTo(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function entry(c: AgreedContradiction, i: number): string {
  const lines = [
    `${i + 1}. Your sentence: "${truncate(c.answer)}"`,
    `   Atlas text it was flagged against: "${truncate(c.evidence)}"`,
    `   The check's reason: "${truncate(c.why)}"`,
  ];
  if (c.uuid) lines.push(`   Source document: ${c.uuid}`);
  return lines.join("\n");
}

const LEAD =
  "Check results that were shown to the user directly beneath your earlier answers — the verification badge, its findings, " +
  "and the Sources marks. They are what the user sees on screen and can ask about. Answers not listed below showed a " +
  "passing badge, or no badge at all.";

const FOOTER =
  "These are check results, not rulings, and not retrieved evidence. The checks compare sentences in isolation and can " +
  'misread scope, pronoun antecedents ("they", "these"), or which subject a rule applies to. If the user asks about a ' +
  "flag, look the source document up with atlas_get and reason about it before agreeing or disagreeing — do not assume " +
  "the flag is correct just because it was shown. Do not restate a flagged sentence unchanged.";

export interface ReviewRow {
  role: string;
  content: string;
  review?: ReviewNote | null;
}

/**
 * How an answer is identified to the model: its position counting back from the
 * latest, plus the opening of its own text.
 *
 * Deliberately NOT a message id — `ReplayRow.id` exists only as the compaction
 * cursor and never reaches the model (context-compact.ts), and a synthetic id
 * minted here would be a new cross-turn identifier to keep stable. An ordinal
 * plus a lead survives compaction and needs neither.
 */
const LEAD_CHARS = 60;
function anchor(content: string, fromLatest: number): string {
  const lead = clipTo(content.replace(/\s+/g, " ").trim(), LEAD_CHARS);
  if (fromLatest === 0) return `[Latest answer — begins “${lead}”]`;
  const n = fromLatest + 1;
  return `[${n} answers earlier — begins “${lead}”]`;
}

function newestBlock(row: ReviewRow, note: ReviewNote): string {
  const parts: string[] = [`${anchor(row.content, 0)}${note.badge ? `  Badge: ${note.badge}` : ""}`];
  for (const f of note.findings) parts.push(` - ${f}`);
  const disputes = note.disputes.slice(0, MAX_DISPUTES);
  if (disputes.length > 0) parts.push(disputes.map(entry).join("\n"));
  if (note.coverage) parts.push(` Coverage: ${note.coverage}`);
  if (note.marks.length > 0) parts.push(` Citations: ${note.marks.join("; ")}`);
  return clipTo(parts.join("\n"), NEWEST_BLOCK_MAX_CHARS);
}

function digestLine(row: ReviewRow, note: ReviewNote, fromLatest: number): string {
  const bits: string[] = [];
  if (note.badge) bits.push(note.badge);
  if (note.findings.length > 0) bits.push(note.findings[0]);
  if (note.coverage) bits.push(note.coverage);
  if (note.marks.length > 0) bits.push(`${note.marks.length} mark${note.marks.length === 1 ? "" : "s"} not a plain check`);
  return clipTo(`${anchor(row.content, fromLatest)} ${bits.join("; ")}`, DIGEST_MAX_CHARS);
}

/**
 * Builds the review round, or `[]` when there is nothing to say — the common
 * case, since most answers pass and contribute no note at all. Pure and
 * deterministic: same input, same output, no I/O.
 *
 * Framing is deliberately NOT a verdict the model should capitulate to, and NOT
 * presented as retrieved atlas evidence either (see FOOTER) — the originating
 * bug report showed a case where the flag itself was likely wrong (a
 * pronoun-antecedent misread), so the model must be free to push back on it,
 * not parrot it.
 */
export function reviewRound(rows: ReviewRow[]): Msg[] {
  // Newest first, capped: an answer older than the lookback cannot appear even
  // if it carries a note.
  const answers = rows.filter((r) => r.role === "assistant").reverse().slice(0, REVIEW_LOOKBACK);
  const withNotes = answers
    .map((row, fromLatest) => ({ row, note: row.review ?? null, fromLatest }))
    .filter((a): a is { row: ReviewRow; note: ReviewNote; fromLatest: number } => a.note !== null);
  if (withNotes.length === 0) return [];

  // The newest answer gets the full block ONLY when it is the newest answer
  // overall; a note on an older answer is a digest even if it is the first one
  // that has a note.
  const blocks: string[] = [];
  const digests: string[] = [];
  for (const a of withNotes) {
    if (a.fromLatest === 0) blocks.push(newestBlock(a.row, a.note));
    else digests.push(digestLine(a.row, a.note, a.fromLatest));
  }

  const fixed = `${LEAD}\n\n`;
  const tail = `\n\n${FOOTER}`;
  const budget = REVIEW_ROUND_MAX_CHARS - fixed.length - tail.length;
  const kept: string[] = [...blocks];
  let used = kept.join("\n").length;
  // Oldest-first drop: the digests are already newest-first, so taking from the
  // front keeps the recent ones and sheds the oldest.
  for (const d of digests) {
    if (used + d.length + 1 > budget) break;
    kept.push(d);
    used += d.length + 1;
  }
  const content = `${fixed}${kept.join("\n")}${tail}`;
  return [
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: REVIEW_TOOL_ID, type: "function", function: { name: REVIEW_TOOL_NAME, arguments: "{}" } }],
    },
    { role: "tool", tool_call_id: REVIEW_TOOL_ID, content },
  ];
}
