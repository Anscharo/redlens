// Rendering for the briefings: the text an agent reads for one sibling set, the
// packing of sets into chunks, and the instruction texts. Pure; see
// doc-briefings.mjs for the overview.

import { BRIEFING_MAX, BRIEFING_MIN } from "./doc-briefings-validate.mjs";
import { buildCitations, buildTree, unlink } from "./doc-briefings-tree.mjs";

/** A body longer than this is cut in the chunk. One document in the corpus is
 *  over it; a description does not need the tail of a 6 KB document. */
const BODY_MAX = 6000;
const PARENT_BODY_MAX = 1500;
const CITATION_MAX = 6;
const CHILD_TITLES_MAX = 12;

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

/** What every writer is told, however the rows come back. */
const INSTRUCTIONS_BODY = `# Writing retrieval descriptions for Sky Atlas documents

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
`;

/** What each subagent is told. Written once to the work directory; every agent
 *  reads it from there, which keeps the per-agent prompt to two paths. */
export const AGENT_INSTRUCTIONS = `${INSTRUCTIONS_BODY}- Write the rows to the output path you were given, as JSON Lines: one object
  per line, no code fence, no commentary, no blank lines between rows.
- Write the file even if the chunk has no WRITE document.
- Reply with the number of rows you wrote and nothing else.
`;

/** What the atlas worker's model is told: the same body, but the rows come back
 *  as the reply, since a chat completion has no file to write. */
export const BRIEFING_REPLY_INSTRUCTIONS = `${INSTRUCTIONS_BODY}- Reply with the rows as JSON Lines and nothing else: one object per line, no code
  fence, no commentary, no blank lines between rows.
- Reply with an empty message if the chunk has no WRITE document.
`;
