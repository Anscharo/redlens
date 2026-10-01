// Bookkeeping for the placement-aware document briefings.
//
// The typical atlas document is one line (median body 124 characters) whose
// meaning lives in where it sits and in who cites it. A strong model writes one
// short description per document from that context, plus two or three questions
// the document answers; those are embedded as a second retrieval signal. The
// writing is LLM judgement, hand-run through subagents. This module does the
// part that must be deterministic: decide WHICH documents need a description,
// lay out the context an agent reads, and admit only valid rows to the
// committed artifact (public/doc-briefings.json).
//
// It is the sibling of mistakes-sweep.mjs and imports that module's digest,
// plan and state functions rather than copying them. Three rules differ, and
// each is deliberate:
//
//   1. The packing unit is a whole SIBLING SET, not a document. A model asked
//      to describe half a parameter block cannot see what tells the members
//      apart, and telling near-identical siblings apart is the point.
//   2. A document is recorded as described only when a VALID ROW for it came
//      back. In the mistakes sweep an intact chunk with no finding means "read
//      it, found nothing". Here every queued document owes a row, so an intact
//      chunk that skipped one leaves that document queued.
//   3. One-hop expansion runs the other way. The mistakes sweep re-reads the
//      documents that CITE something that moved. A briefing is built from a
//      document's parent and from its citers, so what goes stale is the CHILD
//      of a moved document and the TARGET of a moved document's links.
//
// A briefing must never contain a doc number. Doc numbers are editorial labels
// that upstream renumbers wholesale, so one inside the text would invalidate
// the corpus on every renumbering. For the same reason the digest excludes
// `doc_no` (see docDigest) and the artifact is keyed by UUID.
//
// Everything here is pure — the CLI (scripts/aux/doc-briefings.mjs) owns I/O.

import { UUID_LINK_RE } from "./graph-patterns.mjs";
import { docDigest, planSweep } from "./mistakes-sweep.mjs";

/** Artifact version. Bump when the row shape changes. */
export const ARTIFACT_VERSION = 1;

export const BRIEFING_MIN = 40;
export const BRIEFING_MAX = 400;
const QUESTION_MIN = 10;
const QUESTION_MAX = 200;

/** A body longer than this is cut in the chunk. One document in the corpus is
 *  over it; a description does not need the tail of a 6 KB document. */
const BODY_MAX = 6000;
const PARENT_BODY_MAX = 1500;
const CITATION_MAX = 6;
const CITATION_LINE_MAX = 300;
const CHILD_TITLES_MAX = 12;

// Spec-defined doc number shapes (ATLAS_MARKDOWN_SYNTAX.md): a letter-prefixed
// dotted number, and the global Needed Research numbering.
const DOC_NO_RE = /\b[A-Z]\.\d|\bNR-\d/;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const LINK_LABEL_DOC_NO_RE = /^(?:[A-Z]\.[\w.]*\d|NR-\d+)\s+-\s+/;

/** The sibling-set key: a doc number without its last segment, "" for a root.
 *  Structural use of doc_no, the same one embed-units.ts `parentDocNo` makes —
 *  `parentId` cannot serve, because heading depth is capped at 6. It is
 *  recomputed from the live atlas on every run and never stored. */
export function parentKey(docNo) {
  const last = docNo.lastIndexOf(".");
  return last < 0 ? "" : docNo.slice(0, last);
}

/** Replace `[A.1.2 - Title](uuid)` with `Title`. The chunk an agent reads must
 *  not offer it doc numbers or UUIDs to copy. */
export function unlink(text) {
  return (text ?? "").replace(UUID_LINK_RE, (_, label) => label.replace(LINK_LABEL_DOC_NO_RE, ""));
}

/**
 * The tree the chunks are laid out from.
 *
 * → { byDocNo, sets, setOf, ancestorsOf, childrenOf }
 *   sets        [{ key, parent, members }] in atlas order. `parent` is the
 *               nearest ancestor that exists as a document, or null — 140 sets
 *               hang off a string parent that is no document (the `.0.3` in an
 *               Annotation's number, for one).
 *   ancestorsOf node → its existing ancestors, root first.
 *   childrenOf  uuid → the documents whose nearest existing ancestor it is.
 */
export function buildTree(nodes) {
  const byDocNo = new Map(nodes.map((n) => [n.doc_no, n]));
  const ancestorsOf = (node) => {
    const chain = [];
    for (let key = parentKey(node.doc_no); key; key = parentKey(key)) {
      const hit = byDocNo.get(key);
      if (hit) chain.push(hit);
    }
    return chain.reverse();
  };

  const byKey = new Map();
  const sets = [];
  const setOf = new Map();
  const childrenOf = new Map();
  for (const node of nodes) {
    const key = parentKey(node.doc_no);
    let set = byKey.get(key);
    if (!set) {
      set = { key, parent: ancestorsOf(node).at(-1) ?? null, members: [] };
      byKey.set(key, set);
      sets.push(set);
    }
    set.members.push(node);
    setOf.set(node.id, set);
    if (set.parent) {
      if (!childrenOf.has(set.parent.id)) childrenOf.set(set.parent.id, []);
      childrenOf.get(set.parent.id).push(node);
    }
  }
  return { byDocNo, sets, setOf, ancestorsOf, childrenOf };
}

/**
 * Who cites each document, with the citing line.
 *
 * → Map<target uuid, [{ from, line }]>. The links are the ones build-graph
 * emits as the `cites` edge, read with the same regex and derived here for the
 * reason mistakes-sweep gives: relations.json is never committed, and a planner
 * that needed it would behave differently on a fresh checkout. One entry per
 * citing document — its first line that links to the target.
 */
export function buildCitations(nodes) {
  const citations = new Map();
  for (const from of nodes) {
    const seen = new Set();
    for (const line of (from.content ?? "").split("\n")) {
      for (const [, , target] of line.matchAll(UUID_LINK_RE)) {
        const to = target.toLowerCase();
        if (to === from.id || seen.has(to)) continue;
        seen.add(to);
        if (!citations.has(to)) citations.set(to, []);
        citations.get(to).push({ from, line: unlink(line).trim().replace(/\s+/g, " ").slice(0, CITATION_LINE_MAX) });
      }
    }
  }
  return citations;
}

/**
 * moved uuid → the documents whose briefing was written from it.
 *
 * Shaped like mistakes-sweep's `buildBacklinks` so it can be handed to
 * `planSweep` as its `backlinks`, which re-queues the unchanged documents a
 * moved one points at. Here those are its children (their parent and ancestor
 * chain is their context) and its link targets (the citing line is quoted to
 * the agent). `planSweep` expands ONE HOP, which is what keeps a one-word fix
 * from walking out to the whole corpus.
 *
 * Known gap: a citer that is DELETED leaves no links to follow, so its targets
 * keep a description that may still name it until they next move.
 */
export function buildDependents(nodes, tree = buildTree(nodes)) {
  const dependents = new Map();
  const add = (moved, dependent) => {
    if (moved === dependent) return;
    if (!dependents.has(moved)) dependents.set(moved, new Set());
    dependents.get(moved).add(dependent);
  };
  for (const node of nodes) {
    for (const child of tree.childrenOf.get(node.id) ?? []) add(node.id, child.id);
    for (const [, , target] of (node.content ?? "").matchAll(UUID_LINK_RE)) add(node.id, target.toLowerCase());
  }
  return dependents;
}

/**
 * `planSweep`, with one correction for a corpus that is described in sittings.
 *
 * `planSweep` expands from every `new` document. For the mistakes sweep `new`
 * means new to the atlas, because its state has covered the whole corpus since
 * the bootstrap. Here the state starts empty and fills over many sittings, so
 * until it is complete `new` mostly means "not described yet" — and such a
 * document did not move. Expanding from it would re-queue the finished rows of
 * its children and link targets on every sitting (317 of the pilot's 2,332).
 *
 * So while `state.complete` is not set, a document is `linked` only if something
 * it depends on CHANGED or was REMOVED. Once every live document has been
 * described the merge sets `complete`, and from then on `new` means new to the
 * atlas and expands like any other movement.
 */
export function planBriefings(nodes, state, { full = false, tree = buildTree(nodes) } = {}) {
  const plan = planSweep(nodes, state, { full, backlinks: full ? null : buildDependents(nodes, tree) });
  if (full || state?.complete) return plan;
  const fresh = new Set(plan.new);
  const spared = new Set();
  for (const [uuid, causes] of Object.entries(plan.linkedBecause)) {
    const moved = causes.filter((cause) => !fresh.has(cause));
    if (moved.length) plan.linkedBecause[uuid] = moved;
    else {
      delete plan.linkedBecause[uuid];
      spared.add(uuid);
    }
  }
  if (!spared.size) return plan;
  // Back where they came from, in atlas order.
  const unchanged = new Set([...plan.unchanged, ...spared]);
  plan.linked = plan.linked.filter((uuid) => !spared.has(uuid));
  plan.unchanged = nodes.filter((n) => unchanged.has(n.id)).map((n) => n.id);
  return plan;
}

/**
 * About `count` of `ids`, spread evenly over the list in runs of `block`.
 *
 * `--limit` takes the FIRST n of the queue, which in atlas order is one end of
 * the corpus: a partial run made that way says nothing about the other end, and
 * a retrieval eval over it competes against an unrepresentative pool. This
 * keeps whole runs — a run holds whole subtrees, so an embedding group is
 * rarely cut — and chooses which runs to keep so they fall evenly from the
 * first document to the last.
 */
export function spreadSample(ids, count, block = 250) {
  if (count >= ids.length) return [...ids];
  const runs = Math.ceil(ids.length / block);
  const ratio = count / ids.length;
  const kept = [];
  for (let i = 0; i < runs; i++) {
    // Keep run i when the running total of `ratio` crosses a whole number.
    if (Math.floor((i + 1) * ratio + 1e-9) > Math.floor(i * ratio + 1e-9)) kept.push(...ids.slice(i * block, (i + 1) * block));
  }
  return kept;
}

/** True when the state holds a digest for every live document — the point at
 *  which `new` starts to mean "new to the atlas". See planBriefings. */
export function isComplete(nodes, state) {
  return nodes.every((n) => state?.docs?.[n.id] !== undefined);
}

/**
 * Render one sibling set as the text an agent reads.
 *
 * `write` is the set of UUIDs that owe a row. Every other member is rendered
 * too, marked context only: the agent needs the whole set to say what tells a
 * member apart, but rewriting an unchanged sibling's description would re-embed
 * it for nothing.
 */
export function renderSet(set, { tree, citations, write }) {
  const crumbs = set.parent ? [...tree.ancestorsOf(set.parent), set.parent] : [];
  const lines = ["# SET", ""];
  lines.push(
    crumbs.length
      ? `Ancestors, root first: ${crumbs.map((a) => `${a.title} [${a.type}]`).join(" › ")}`
      : "Ancestors: none — these are top-level documents.",
  );
  if (set.parent) {
    const body = unlink(set.parent.content).trim();
    lines.push("", `Parent: ${set.parent.title} [${set.parent.type}]`);
    if (body) lines.push(body.length > PARENT_BODY_MAX ? `${body.slice(0, PARENT_BODY_MAX)} […]` : body);
  }
  for (const node of set.members) {
    const owes = write.has(node.id);
    lines.push("", `## ${node.title} [${node.type}]`, `UUID: ${node.id}`, owes ? "WRITE" : "CONTEXT ONLY — write no row");
    const children = tree.childrenOf.get(node.id) ?? [];
    if (children.length) {
      const titles = children.slice(0, CHILD_TITLES_MAX).map((c) => c.title).join("; ");
      lines.push(`Children (${children.length}): ${titles}${children.length > CHILD_TITLES_MAX ? "; …" : ""}`);
    }
    const cited = citations.get(node.id) ?? [];
    if (cited.length) {
      lines.push(`Cited by (${cited.length}):`);
      for (const c of cited.slice(0, CITATION_MAX)) lines.push(`- ${c.from.title} [${c.from.type}]: ${c.line}`);
    }
    const body = unlink(node.content).trim();
    lines.push("Body:", body ? (body.length > BODY_MAX ? `${body.slice(0, BODY_MAX)} […]` : body) : "(empty)");
  }
  return lines.join("\n");
}

/**
 * Pack rendered sets into chunks that fit an agent's context.
 *
 * `rendered` is [{ set, text, docs }] where `docs` are the UUIDs owing a row.
 * A chunk never splits a set. A set larger than the budget gets its own chunk
 * rather than being cut — the same rule `chunkDocs` applies to a document.
 * `maxRows` caps what one agent has to write: thin documents pack over a hundred
 * to a 40 KB chunk, and the rows an agent owes grow with the count, not the bytes.
 */
export function packSets(rendered, { maxBytes = 40_000, maxRows = 80 } = {}) {
  const chunks = [];
  let current = { texts: [], docs: [] };
  let size = 0;
  for (const item of rendered) {
    const cost = item.text.length + 8;
    if (current.texts.length && (size + cost > maxBytes || current.docs.length + item.docs.length > maxRows)) {
      chunks.push(current);
      current = { texts: [], docs: [] };
      size = 0;
    }
    current.texts.push(item.text);
    current.docs.push(...item.docs);
    size += cost;
  }
  if (current.texts.length) chunks.push(current);
  return chunks;
}

/** The sets holding at least one queued document, each rendered whole. */
export function renderQueue(nodes, queued, { tree = buildTree(nodes), citations = buildCitations(nodes) } = {}) {
  const write = new Set(queued);
  return tree.sets
    .filter((set) => set.members.some((m) => write.has(m.id)))
    .map((set) => ({
      set,
      text: renderSet(set, { tree, citations, write }),
      docs: set.members.filter((m) => write.has(m.id)).map((m) => m.id),
    }));
}

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
 * came back, kept otherwise, and dropped when the atlas no longer has the
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

/** What each agent is told. Written once to the work directory; every agent
 *  reads it from there, which keeps the per-agent prompt to two paths. */
export const AGENT_INSTRUCTIONS = `# Writing retrieval descriptions for Sky Atlas documents

The Sky Atlas is a large governance rulebook. Most of its documents are one line
long. What such a document means comes from where it sits in the tree and from
the documents that cite it. A search engine will embed what you write and match
it against readers' questions, so that a reader can find a one-line document
from a question that shares no word with it.

## Input

One chunk file. It holds several SETS. A set is every child of one parent
document. Each set opens with its chain of ancestors and its parent. Each
document in it shows its title and type, a UUID, the titles of its own children,
the documents that cite it with the citing line, and its body.

## Output

For every document marked WRITE, one line of JSON:

{"uuid":"…","briefing":"…","questions":["…","…"]}

**briefing** — one to three sentences, ${BRIEFING_MIN} to ${BRIEFING_MAX} characters. Say what the document
is and what it establishes IN CONTEXT: which agent, primitive, instance, scope,
process or parameter block it belongs to, what part it plays there, and what
tells it apart from its siblings. Use the names of its ancestors and of the
documents that cite it as plain words. Add what the body does not say. A briefing
that only repeats the body is rejected.

**questions** — two or three questions a reader would type into a search box
that THIS document answers and its siblings do not. Plain wording. Each ends
with a question mark. Name the specific agent, instance or parameter, so the
question could not equally be asked of a sibling.

## Rules

- Never write a document number (the dotted labels that start with a capital
  letter, or an NR label) and never write a UUID inside a briefing or a question.
  Refer to a document by its title. A row that breaks this is rejected.
- State only what the chunk shows. No outside knowledge and no guesses. If the
  chunk does not say what a parameter's value means, do not invent it.
- Copy each uuid exactly from its UUID line.
- One row for each WRITE document. No row for a CONTEXT ONLY document.
- Every row carries at least two questions, however short the document. A row
  with one question is rejected and its document counts as not described.
- Write the rows to the output path you were given, as JSON Lines: one object
  per line, no code fence, no commentary, no blank lines between rows.
- Write the file even if the chunk has no WRITE document.
- Reply with the number of rows you wrote and nothing else.
`;
