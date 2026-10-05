// Validation and the committed artifact for the briefings: parse and check
// agent rows, merge them in, serialize, and shape database rows back into the
// artifact. Pure; see doc-briefings.mjs for the overview.

import { docDigest } from "./mistakes-sweep.mjs";

/** Artifact version. Bump when the row shape changes. */
export const ARTIFACT_VERSION = 1;

export const BRIEFING_MIN = 40;
export const BRIEFING_MAX = 400;
const QUESTION_MIN = 10;
const QUESTION_MAX = 200;

// Spec-defined doc number shapes (ATLAS_MARKDOWN_SYNTAX.md): a letter-prefixed
// dotted number, and the global Needed Research numbering.
const DOC_NO_RE = /\b[A-Z]\.\d|\bNR-\d/;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Parse one agent output file.
 *
 * → the rows, or null when any line is not JSON. A truncated last line means
 * the agent died mid-write and the rest of the chunk is unknowable, so the
 * caller treats the whole chunk as unprocessed.
 */
export function parseRows(text) {
  const lines = text.split("\n").filter((l) => l.trim());
  try {
    return lines.map((l) => JSON.parse(l));
  } catch {
    return null;
  }
}

const squash = (s) => s.trim().replace(/\s+/g, " ");
const bare = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Validate one agent-written row.
 *
 * Rows are model output, so every field is checked before it can reach the
 * committed artifact. `requested` is the chunk's own list of documents owing a
 * row: a row for anything else is dropped, so an agent that also rewrites a
 * context-only sibling cannot churn it.
 *
 * → { ok: true, uuid, entry } | { ok: false, reason }
 * `entry` holds only what the model may supply. `digest` and `model` are
 * stamped by the merge, from the atlas and from the run.
 */
export function validateBriefing(row, nodeMap, requested = null) {
  if (!row || typeof row !== "object") return { ok: false, reason: "not an object" };
  const node = nodeMap[row.uuid];
  if (!node) return { ok: false, reason: `unknown uuid ${row.uuid}` };
  if (requested && !requested.has(node.id)) return { ok: false, reason: `row for a document this chunk did not ask for (${node.id})` };
  if (typeof row.briefing !== "string") return { ok: false, reason: "missing briefing" };
  const briefing = squash(row.briefing);
  if (briefing.length < BRIEFING_MIN || briefing.length > BRIEFING_MAX)
    return { ok: false, reason: `briefing is ${briefing.length} chars (want ${BRIEFING_MIN}-${BRIEFING_MAX})` };
  if (!Array.isArray(row.questions) || row.questions.length < 2 || row.questions.length > 3)
    return { ok: false, reason: "questions must hold 2 or 3 entries" };
  const questions = [];
  for (const q of row.questions) {
    if (typeof q !== "string") return { ok: false, reason: "question is not a string" };
    const text = squash(q);
    if (!text.endsWith("?")) return { ok: false, reason: "question does not end with ?" };
    if (text.length < QUESTION_MIN || text.length > QUESTION_MAX)
      return { ok: false, reason: `question is ${text.length} chars (want ${QUESTION_MIN}-${QUESTION_MAX})` };
    questions.push(text);
  }
  for (const text of [briefing, ...questions]) {
    if (DOC_NO_RE.test(text)) return { ok: false, reason: "contains a doc number" };
    if (UUID_RE.test(text)) return { ok: false, reason: "contains a UUID" };
  }
  // A briefing that only repeats the body adds no signal: the body is already
  // embedded. Compared with punctuation and case removed, so re-punctuating the
  // body does not get past the check.
  const echo = bare(briefing);
  if (bare(`${node.title} ${node.content ?? ""}`).includes(echo))
    return { ok: false, reason: "briefing repeats the document" };
  return { ok: true, uuid: node.id, entry: { briefing, questions } };
}

/**
 * Fold validated rows into the previous artifact's `briefings` map.
 *
 * `incoming` is [{ uuid, entry }]. A document's row is replaced when a new one
 * came back, kept otherwise, and dropped when the atlas does not have the
 * document. Keys are sorted by UUID, not atlas order, so a renumbering does not
 * reshuffle the committed file.
 */
export function mergeBriefings(previous, incoming, nodeMap, removed = [], model = null) {
  const next = { ...previous };
  for (const uuid of removed) delete next[uuid];
  let added = 0;
  let replaced = 0;
  for (const { uuid, entry } of incoming) {
    if (next[uuid]) replaced++;
    else added++;
    next[uuid] = { ...entry, digest: docDigest(nodeMap[uuid]), model };
  }
  const briefings = Object.fromEntries(Object.keys(next).sort().map((uuid) => [uuid, next[uuid]]));
  return { briefings, added, replaced, kept: Object.keys(briefings).length - added - replaced };
}

/** The exact text a briefing is embedded as. The retrieval eval's "both" block
 *  and the worker's embed pass both call this, so the vectors production stores
 *  are the ones the eval measured. `questions` is tolerated missing because the
 *  eval reads rows from a file a hand edit may have thinned. */
export function briefingEmbedText(row) {
  return `${row.briefing}\n${(row.questions ?? []).join("\n")}`;
}

/**
 * The text of public/doc-briefings.json. `merge` and `pull` both write through
 * this, so the two cannot produce different shapes. One row per line, so a
 * rewrite of one briefing is a one-line diff. `briefings` must already be in
 * the order to write (UUID order, which `mergeBriefings` and `pullBriefings`
 * both give).
 */
export function serializeArtifact(briefings, atlasSha) {
  const body = Object.entries(briefings)
    .map(([uuid, row]) => `${JSON.stringify(uuid)}:${JSON.stringify(row)}`)
    .join(",\n");
  return `{"version":${ARTIFACT_VERSION},"atlasSha":${JSON.stringify(atlasSha)},"briefings":{\n${body}\n}}\n`;
}

/** True when two rows say different things. Only the text counts: `digest` and
 *  `model` move with a rewrite, and a row that moved without its text moving
 *  changes nothing a reader could see. */
export function briefingTextDiffers(a, b) {
  if (!a || !b) return true;
  return briefingEmbedText(a) !== briefingEmbedText(b);
}

/**
 * Shape database rows as artifact rows, in UUID order.
 *
 * `rows` are { doc_id, briefing, questions, digest, model }. A placeholder row
 * (`briefing === ''`, it only carries a failure count) is not a briefing and is
 * left out. Key order inside a row matches `mergeBriefings`, so a row the
 * database took from the file serialises to the same bytes.
 */
export function pullBriefings(rows) {
  const out = {};
  for (const row of [...rows].sort((a, b) => (a.doc_id < b.doc_id ? -1 : a.doc_id > b.doc_id ? 1 : 0))) {
    if (row.briefing === "") continue;
    out[row.doc_id] = { briefing: row.briefing, questions: row.questions, digest: row.digest, model: row.model ?? null };
  }
  return out;
}

/** How many of `pulled` are not in `file` or say something different. */
export function countDiffering(file, pulled) {
  return Object.entries(pulled).filter(([uuid, row]) => briefingTextDiffers(file[uuid], row)).length;
}
