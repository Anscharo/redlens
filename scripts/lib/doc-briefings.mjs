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

export * from "./doc-briefings-tree.mjs";
export * from "./doc-briefings-plan.mjs";
export * from "./doc-briefings-render.mjs";
export * from "./doc-briefings-validate.mjs";
