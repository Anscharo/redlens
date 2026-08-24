# Graph Extraction

The Atlas states relationships in prose. It does not ship a relational index.
RedLens builds one: a typed, directed graph over documents, extracted actors,
and on-chain addresses, so a question like "which multisigs does this org sign
for?" is a traversal rather than a full-text read.

This is an overview of that extraction and why it is checkable. It is not a
spec. Pattern-by-pattern rules live in `.claude/skills/parse-atlas/SKILL.md`.
When this doc disagrees with the code or the built artifacts, those win.

## Whose graph this is

> The Atlas is the source documents. **Entities, relations, roles, addresses,
> params, and every report built on them are RedLens's extraction — not Atlas
> text.**

An edge is our reading of a sentence. An entity is our decision that a named
thing deserves a node. A param value is our stripping of a leaf document. The
Atlas can be quoted; the extraction must be attributed ("our extraction
shows…").

The graph is a lossy, opinionated index, not a database of Atlas truth. When it
disagrees with the prose, the prose wins and the extractor has a bug.

Some of the graph is near-mechanical transcription. Some of it is a judgment
call — the Atlas underdetermines the shape, or a literal reading would
over-fragment the model. Those calls, with rationale and cost, live in the
skill's **Editorial Decisions**. The matching negative list — **Not in the
atlas**, **Out of Scope** — is what "the Atlas does not record that" is allowed
to rest on.

## What we extract

`pnpm build:graph` reads the parsed documents (`public/docs.json`) and both
address artifacts. It never re-parses Atlas markdown, and it never writes back
into the document index.

In order:

1. **Addresses in prose** — every document is scanned for EVM and Solana
   addresses and tagged with chain, structural role, and a candidate label.
   This runs first so later entity extraction can see, for example, a delegate
   role and create the right kind of node.
2. **Entities** — agents, facilitators, GovOps orgs, delegates, accord parties,
   primitives, instances.
3. **Edges** — document structure (parentage, annotation, citation, ICD
   linkage) and entity/address relationships (roles, membership, duties,
   ownership). Then Active Data tables whose rows are actors, then the
   structural conventions that need everything else to exist: multisigs,
   transfers, bridges, per-agent governance, pending handoffs.
4. **ICD addresses** — an address in a structured parameter is stronger
   evidence than surrounding prose; it produces ownership edges and overrides
   the earlier heuristics.
5. **Address enrichment** — five gap-filling passes over the atlas address
   artifact (ICD, entity, titles, then chainlog/explorer fallback).

The full extraction is `public/graph.json`. The browser gets
`public/relations.json`, a filter of the same graph (structural parentage and
chat-only edge types dropped). Atlas-derived address annotation and on-chain
facts live in separate files so "what the documents say" and "what the chain
says" cannot mix. None of these artifacts are committed; they are rebuilt on
Atlas drift.

Addresses are keyed by address **and** chain: the same string is a different
account on different networks. ICD params beat prose. The chain registry is
the single source of truth — an unknown chain otherwise collapses to Ethereum
with no error.

## Why it is reliable

Reliability here is not "the model is usually right." It is: every claim is
traceable, identity does not move under us, and a silent empty match cannot
pass as a successful build.

**Every edge is auditable.** It carries `source_doc_nos` — the documents whose
text establishes it. An edge without provenance cannot be shown or cited. (A
few purely structural edges — parentage, table membership — are exempt:
their provenance *is* their endpoints.) To check an edge: open those
documents, read them, and if the prose does not say what the edge claims, the
extractor is wrong. Do not "correct" the Atlas. Param values travel as
`[value, srcUuid, srcDocNo]`, so the leaf they were stripped from is one
lookup away. An entity points at its defining document.

**Identity is the UUID, not the doc number.** Doc numbers encode editorial
position and the Atlas renumbers. Anchoring extraction on them has already
failed in production: an A.1 renumbering silently zeroed several delegate and
membership edge types for months. Anchors are UUID constants now, and they
warn when a UUID goes missing. (The Atlas syntax spec's structural suffixes —
`.0.3.X` annotations, `.0.4.X` tenets, and so on — are a real exception;
those are format, not editorial labels.)

**The loader throws; it never guesses.** "Found no documents" and "this is some
other layout" look identical, and so does a truncated checkout. Falling back
would turn a broken Atlas into a successful empty graph, and every report
downstream would agree. `pnpm check:atlas` recounts documents with a
layout-blind scan at merge time for the same reason: a check that asks the
loader just agrees with itself.

**Empty is the failure mode, so each class has an alarm.** A filter over zero
matches is not an error; a rename produces silence, not an exception.

| What would go unnoticed | What catches it |
| --- | --- |
| A renumber or rename empties a whole entity family | Zero-match tripwires (`graph-tripwires.mjs`) — the build still "succeeds", CI's warnings diff does not |
| Extraction quietly reshapes the graph | Snapshots of `relations.json` (`pnpm test:snap`) — every Atlas bump or extractor edit is a reviewable diff |
| The Atlas starts encoding structure no pattern handles | Coverage census (`pnpm census:check`) — documents that contributed nothing to the graph, warned against a baseline |
| A chain the registry has never heard of | Chain census (`pnpm census:chains`) |
| The build didn't read the whole Atlas | `pnpm check:atlas` |
| All of the above, but nobody looked | Weekly healer: reruns every census, re-checks snapshots, opens an issue |

Two habits keep those alarms honest: when a new pattern consumes a document,
credit it (or the coverage census keeps counting it as uncovered); never
update a baseline or snapshot to silence a warning without knowing what
changed.

---

Pattern rules and editorial rationale:
`.claude/skills/parse-atlas/SKILL.md`. On-chain address detection:
`.claude/skills/address-extraction/SKILL.md`.
