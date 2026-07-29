---
name: analyst-anatomy
description: >
  Methodology for building out the Atlas Anatomy's analyst content — the
  /reports/anatomy section (Shape, Concepts, Audit, Glossary) and its research
  docs. Triggered by phrases like "analyst anatomy", "atlas anatomy", "concept
  mining", "concept catalog", "chunk digest", "onboarding checklist", or any
  work on docs/anatomy/*, src/lib/anatomyShape.ts, or
  src/components/anatomy/*. Covers the locked design decisions, the
  quote-or-gap evidence discipline, the concept-mining method ladder, and the
  session practices for this feature.
license: MIT
metadata:
  author: anscharo
  version: "1.0"
---

# analyst-anatomy

The Atlas Anatomy is a scholarly layer over the 10,780-doc Sky Atlas: the *shape* of the
corpus as hierarchical functional chunks with weights, a cross-cutting concept catalog with
its audit, a glossary, and (planned) per-chunk digest pages with staleness signals. It
escapes the two bad consumption modes — monolith scroll and atom-pile.

**Read first, on demand:**
- `docs/plans/atlas-anatomy.md` — product plan: the four faces, 7 staleness signals, phases.
- `docs/features/atlas-anatomy/LOG.md` — append-only work log; bottom-up = latest state.
- `docs/atlas-map.md` — the chunk-taxonomy research the GROUPS seed came from.

**Deliverables map:**
- `docs/anatomy/concepts.md` — the concept catalog (shipped in-app: Concepts tab, `?raw` import).
- `docs/anatomy/concepts-audit.md` — its evidence-tier audit (shipped in-app: Audit tab).
- `references/dr-partner-onboarding.md` (in this skill folder) — the worked exemplar of the
  quality bar: an operational checklist where every statement is an exact relay (quote/cite,
  UUID-verified) or an explicitly labeled gap. Three user-caught errors forged this form —
  match it before publishing anything Atlas-derived.
- `src/lib/anatomyShape.ts` — the shape compute (chunk trees, weights, totals),
  derived client-side by `loadAnatomy` (`src/lib/anatomy.ts`).

## Locked decisions — do not relitigate

1. **Chunks are hierarchical.** A flat taxonomy was built and rejected (Agent artifacts =
   69% of the Atlas rendered as one bar). The model is a recursive `chunkTree`: curated
   taxonomy groups on top, semantic subtree beneath.
2. **Inside agent artifacts `parentId` is unreliable** (heading depth caps at 6; the tree
   goes flat). Real nesting is rebuilt from doc_no segments (`semParent`/`semChildren` in
   `scripts/lib/anatomy-shape.mjs`). UUIDs are identity; doc_nos only in comments — except
   the spec-guaranteed structural suffixes (`.0.3.X`, `.0.4.X`, `.1.X`, `.varX`, `.0.6.X`,
   `NR-X`).
3. **The anatomy shape is computed client-side, not shipped as an artifact.** There
   WAS a `public/anatomy.json` (full artifact lifecycle + `SCHEMA_V` skew guard); it
   was folded away 2026-07-24 once measured at 2 MB — a pure projection of docs.json
   that cost more to ship than to compute (Stale Dates pattern). `loadAnatomy`
   (`src/lib/anatomy.ts`) now derives `AnatomyData` from `loadAtlas` + `loadGlossary`
   per data-source base — which also makes the anatomy work over previews. The
   compute (`src/lib/anatomyShape.ts`, `computeAnatomy`) is pure and server-importable;
   the MCP `atlas_describe` "stats" section reuses it, trimmed (`src/server/tools-stats.ts`).
4. **Generated skeleton, curated flesh.** Structure/weights are computed by build passes;
   scholarly prose is authored markdown checked into git.
5. The curated taxonomy (UUID roots) is `GROUPS` in `src/lib/anatomyShape.ts`; recursion
   prunes at `MIN_CHUNK_DOCS = 5`; single-child chains hoist at group roots. Known accepted
   risk: an atlas restructure that removes a root UUID throws — the census/baseline drift
   guard is planned P1 work. Known carried quirk: `.varX` docs attach to the scenario's
   parent, not the scenario (3 docs; locked in `anatomyShape.test.ts` until deliberately fixed).

## Evidence discipline (standing rules, user-imposed)

- **Quote-or-gap.** In Atlas-derived research docs, every statement is either an exact
  relay of Atlas text (quoted and/or cited by UUID) or explicitly labeled as our own
  procedure-design note / gap. Never present inferred content as Atlas-derived.
- **Agent reports are leads, not sources.** Nothing from a subagent enters a deliverable
  until the cited doc has been read from source. Every one of the three DR-onboarding
  errors came from relaying agent output unread.
- **Cite counts honestly** — "≈" when sampled, exact when censused. Never fabricate member
  lists. Verify every cited UUID resolves against `docs.json` before publishing.
- **Corrections stay visible** — in-place correction notes, not silent rewrites; the
  catalog is scholarship and its error history is part of the record.
- **Epistemic tiers** (from the audit): T1 censused/byte-grounded → T4 agent-unverified.
  Label claims so a reader sees which is which.

## Concept mining — the method ladder

Mission: catalog every coherent conceptual grouping that does NOT follow the tree (the
tree is editorial; concepts are sprinkled across it). Groups nest and overlap — record
multiple memberships, never force one hierarchy. Every claimed group carries: definition
(one sentence), detection signature (how to re-find it mechanically), members or
count + exemplar UUIDs, spread (which scopes/chunks), relationships to other concepts.
Record dead ends too.

In order of cheapness, iterate through:

1. **Data-model priors** — the graph's 44 edge types and entity subtypes are ready-made
   concept relations (`atlas_describe`, `public/relations.json`, `src/server/tool-registry.ts`).
2. **Title-pattern census over docs.json** — recurring titles are templates ("Operational
   Process Definition", "Parameters", "Data Repository"…); each high-count template is a
   category, each singleton worth reading.
3. **Content-pattern census** — normative language (MUST/SHALL), KaTeX math, tables, dated
   commitments, numbered step lists.
4. **MCP semantic sweeps** — `atlas_search`/`atlas_query` for concept names; `atlas_traverse`
   from hubs to harvest spread. Prefer MCP atlas tools over grep.
5. **Existing curation** — `processes.json`, `glossary.json`, the reports' data modules.
   Reuse, don't re-derive.
6. **Subagents** (ask-atlas / Explore) for deep parallel reading; synthesis stays in the
   main context — subject to the evidence discipline above.

Promoting concept groups into `anatomy.json`/UI is a decision made WITH the user, never
unilaterally.

## Session practices

- Commit in reasonable chunks with why-messages; stage and hand the commit command to the
  user (never commit yourself). Append to `docs/features/atlas-anatomy/LOG.md` at every
  commit — it is the recovery point for context-less future sessions.
- Patch-notes: one bullet per user-visible feature; follow-ups to the same unreleased
  feature revise the existing bullet, never add one.
- `pnpm exec tsc -b` clean; verify UI by screenshot against the dev server; shape
  changes to `AnatomyData` update the types in `src/lib/anatomy.ts` + the
  `anatomyShape.test.ts` expectations in the same commit.
- Max ~150 lines/file, ≤3 components/file; `node:` import prefix; semantic HTML; CSS over
  JS for hover/click.
