# Concept Mining — mission prompt

This is a self-prompt. Execute it with maximum effort whenever continuing the concept-
mining work. It encodes the user's intent from 2026-07-21; treat it as the brief. The
deliverable grows in `docs/library/concepts.md`; progress notes go to `LOG.md` as always.

## Mission

Discover and catalog **every coherent conceptual grouping** in the Sky Atlas — the
groupings that do NOT follow the tree. The tree (scopes → articles → sections) is the
*editorial* organization; concepts are *sprinkled* across it, cross-linking to
themselves. Examples the user gave, to calibrate grain:

- "Distribution Rewards" the **concept** (its primitive spec, its reward infrastructure
  rules, its per-agent instances, its invocations, its integration partners) — one
  conceptual group whose members live in A.2.2, A.4.3, and eight agent artifacts.
- **Procedures** as a category — the set of all step-by-step procedures wherever they
  live (process definitions, protocols, cycles, playbooks).
- Likewise **Formulas**, **Policy Statements**, **Definitions of Terms**, **Programs**,
  **Accords**, **Rules**, **Agent Artifacts**, "and more."

Concept groups NEST (a specific procedure belongs to Procedures AND to its host concept,
e.g. the Root Edit procedure belongs to Root Edit) and OVERLAP (an Active Data doc can
be both a Parameter Set and part of a Program). Do not force a single hierarchy — record
multiple memberships explicitly.

## Quality bar

Useful insights, distinctions, and discovered relationships — enough that a talented
analyst can go deeper without redoing the mining. Every claimed group must carry:
1. **Definition** — one sentence: what makes something a member.
2. **Detection signature** — how it was found / how to re-find it mechanically (title
   pattern, doc type, edge type, content pattern, curated list). This makes the catalog
   regenerable and falsifiable.
3. **Members or member-count + exemplars** — UUIDs (doc_no in parens) for exemplars;
   full member lists only when small (<20) or high-value.
4. **Spread** — which scopes/chunks the members live in (the cross-tree evidence).
5. **Relationships** — which other concepts it contains, instantiates, governs, or
   overlaps.

Keep refining distinctions while chewing: when two groups blur (Rule vs Policy
Statement, Program vs Primitive), write down the distinction that separates them or
merge them and say why. Record dead ends too (candidate groupings that turned out
incoherent) — they save the next pass time.

## Method (in order of cheapness — do all, iterate)

1. **Data-model priors.** The graph already encodes concepts as edges: 44 edge types
   (duty_for, ecosystem_accord, funds_transfer, signer_of, invoked_by, instance_of,
   annotates, active_data_for…). Each non-structural edge type IS a concept-relation
   candidate. `atlas_describe` (+ entity_type_graph, type_specifications sections),
   `public/relations.json`, `src/server/tool-registry.ts` describe it. Entity subtypes
   (primitive/instance/invocation × 15 subtypes) are ready-made instance sets.
2. **Title-pattern census over docs.json.** Recurring titles are templates: "Operational
   Process Definition", "Routine/Non-Routine/Emergency Protocol", "Parameters",
   "Custom Instance Parameters", "Data Repository", "Initial Planning", "Requirements",
   "Short-Term Transitionary Measures", "General Provisions", "Definitions"… Count each
   recurring title; each high-count template is a concept category; each singleton title
   worth reading.
3. **Content-pattern census.** Normative language (MUST/SHALL/prohibited/required),
   math (KaTeX `$$`, formulas), tables (Active Data tables, parameter tables), dated
   commitments, numbered step lists (`1.` sequences = procedures).
4. **MCP semantic sweeps.** atlas_search/atlas_query for concept names ("dispute
   resolution", "emission", "buffer", "incubation", "derecognition"…) to find members
   editorial placement hides. atlas_traverse from concept hubs to harvest their spread.
5. **Existing curation.** public/processes.json (curated procedures inventory),
   glossary.json (81 defined terms), the reports' data modules (riskRules, staleDates,
   facilitatorResponsibilities, activeDataIndex, rewardsIndex) — each is a concept group
   someone already validated. Reuse, don't re-derive.
6. **Subagents** (ask-atlas / Explore) for deep reading of heavy dimensions in parallel;
   keep synthesis in the main context.

## Output: docs/library/concepts.md

Structure (keep; extend):
- **Part I — Concept catalog**: the giant list, grouped by concept KIND (Structural,
  Normative, Procedural, Quantitative, Programmatic, Relational/Social, On-chain,
  Lifecycle, Meta). Each entry per the quality bar above.
- **Part II — Indexes** (same data, different cuts):
  - by scope (what concepts touch each scope — the spread matrix)
  - by detection signature type (doc-type / title-template / edge-type / content-pattern
    / curated)
  - by lifecycle (spec → activation → instance → invocation → archive)
  - containment/nesting map (which concepts nest inside which)
  - cross-link hubs (most-cited docs; concepts with highest cross-scope spread)
- **Part III — Distinctions & open questions**: the refined distinctions (with the blur
  cases), dead ends, and what a deeper pass should do next.

## Constraints

- UUIDs are identity; doc_nos are comments. Never key on doc_no except spec-guaranteed
  structural suffixes (.0.3.X annotations, .0.4.X action tenets, .1.X scenarios, .varX,
  .0.6.X active data, NR-X).
- Cite counts honestly — say "≈" when sampled, exact when censused. Never fabricate a
  member list.
- Commit in chunks with LOG.md notes (session discipline).
- This catalog is research (docs/), not yet an app artifact. Promoting concept groups
  into library.json/UI is a LATER decision with the user.
