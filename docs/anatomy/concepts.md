# Atlas Concept Catalog

The cross-cutting conceptual groupings of the Sky Atlas — the organization that does
NOT follow the tree. Mission + method: the `analyst-anatomy` skill
(`.claude/skills/analyst-anatomy/SKILL.md`). Signatures re-run live against the
checked-out atlas commit; prose interpretations are dated at the pass that wrote
them. Ten of the mechanical signatures below are backed by a standing drift
guard (`pnpm census:concepts`, `src/lib/conceptsCensus.ts`) — a `:::census
<slug>` block renders the live count + member list right in this doc instead
of a number frozen at whatever atlas commit last touched the prose.

**Epistemic labels** — every group below now carries an evidence-level tag (per
`docs/anatomy/concepts-audit.md`'s rewrite plan), rendered here as a small
colored pill rather than the literal bracket text. Each tag names exactly ONE
level — never a combined `[evidence level 3 · corroborated / evidence level 4 · unverified]`-style
range; where one section mixes evidence strengths, each span carries its own
separate tag. The level is the strongest evidence backing that span:
**`[evidence level 1 · censused]`** script-censused (re-run per atlas bump,
several wired to a live `:::census` block); **`[evidence level 2 ·
source-read]`** an agent verified the claim against the Atlas doc's verbatim
content; **`[evidence level 3 · corroborated]`** agent-derived, since
corroborated (a subagent claim later checked and confirmed);
**`[evidence level 4 · unverified]`** agent-derived, unverified (relayed from a
subagent report without an in-session read — treat as a lead, not a fact,
until checked). See concepts-audit.md for the full spot-check log this rubric
is based on.

Each concept group carries four fields:

- **Definition** — the membership rule: what makes a document belong to this group.

- **Detection signature** — how the group was found and can be mechanically
  re-found (title pattern, doc type, edge type, content pattern, or curated
  list) — this is what keeps every group regenerable and falsifiable.

- **Members / Spread** — who is in the group (counts, exemplars with pointers)
  and where they live across the tree — the evidence that the concept cuts
  across the Atlas rather than sitting in one branch.

- **Relationships** — how the group connects to other groups: nests inside,
  contains, instantiates, overlaps.

---

## Part I — Concept catalog

### Meta-concepts (the Atlas describing itself)

*[evidence level 1 · censused] — doc-type counts, glossary extraction, NR-number gaps, and the ghost-type set difference are all script-censused.*

**Meta 1 · Document Type System**

- **Definition** — the Atlas's own vocabulary of 30 document types.

- **Detection signature** — `type: Type Specification`, all under `f65c083f` /A.1.2.2 (registry doc `A.1.2.2.2 List Of Document Types And Their Specifications`).

- **Members** — 30, all in A.1.

- **Relationships** — contains every overlay concept below; several spec'd types have no instances in the corpus (candidate staleness or future machinery) — the ghost/used split and full member list:

:::census ghost-doc-types

**Meta 2 · Definitions of Terms**

- **Definition** — canonical term definitions collected in Definitions sections.

- **Detection signature** — glossary extraction (direct [Core] children of `Definitions` sections) → `public/glossary.json`.

- **Members** — 81 terms from 3 sites: A.0 (56), A.1 (16), A.3 (9).

- **Relationships** — terms are used corpus-wide; definition sites are NOT where the concepts operate (e.g. "Distribution Reward" defined in A.0, operates in A.2/A.4/A.6).

**Meta 3 · Interpretations**

- **Definition** — recorded rulings on the Spirit of the Atlas.

- **Detection signature** — subtree of `55626fc2` /A.1.1.3 List Of Interpretations (+ its Active Data list).

- **Relationships** — registry pattern (Registries 1); normative meta-layer.

**Meta 4 · Needed Research**

- **Definition** — open questions the Atlas assigns itself.

- **Detection signature** — `type: Needed Research`, `NR-X` doc_nos.

- **Members** — 12. **Discovery: NR numbering has gaps** (present: 1,2,3,4,5,7,8,9,10,12,17,18 — missing 6,11,13–16): items were resolved/removed; history could recover them.

- **Relationships** — two NRs share a title ("Systematic Basis Of Adjudication, Fact-Finding And Evidence" — NR-1, NR-8), linking to the Adjudication concept (Norms group).

**Meta 5 · Annotations**

- **Definition** — commentary attached to elements.

- **Detection signature** — `type: Annotation` (structural suffix `.0.3.X`), `annotates` edges (101).

- **Spread** — A.1 (47), A.2 (10), A.3 (8), A.0 (2), artifacts (1) — concentrated on the Governance Scope.

**Meta 6 · Action Tenets & Precedents**

- **Definition** — behavioral directives for Facilitators.

- **Detection signature** — `type: Action Tenet` (`.0.4.X`).

- **Members** — 30 — only in A.0 (2) + A.1 (28).

- **Relationships** — the paired "Facilitator Action Precedent" type is spec'd but unpopulated (Meta 1).

**Meta 7 · Scenarios**

- **Definition** — worked governance examples w/ variations.

- **Detection signature** — `type: Scenario`/`Scenario Variation` (`.1.X`, `.varX`).

- **Members** — 6+3, all in A.1.

### Lifecycle concepts (the primitive machine)

*[evidence level 1 · censused] — title-template and entity/instance counts are script-censused. (Lifecycle 7's contents are separately labeled on its heading.)*

**Lifecycle 1 · Primitive** (class)

- **Definition** — reusable capability spec with hub/instances/ invocations lifecycle.

- **Detection signature** — entity_type `primitive` (15 subtypes × 8 agents = 120 entities); spec anatomy at `fcde2604` /A.2.2.

- **Relationships** — contains Lifecycle 2–6; instantiated per-agent in artifacts.

**Lifecycle 2 · Primitive Hub Document**

- **Definition** — per-primitive per-agent status+directory root.

- **Detection signature** — title template. A representative sample of the exact-title families cited across this catalog (Primitive Hub Document, Global Activation Status, Hub Data Repository, Parameters, Rate Limits, the Data Repository triad, Omni Documents, the ICD title) is censused together:

:::census title-templates

- **Relationships** — contains Lifecycle 3 directories.

**Lifecycle 3 · Instance Directories & Status Buckets**

- **Definition** — the Active/Completed/ In-Progress/Suspended/Failed/Archived containers.

- **Detection signature** — title templates (×130–144 each).

- **Relationships** — the empty ones are the validated staleness signal — most status-bucket directories are empty scaffolding (a state that hasn't happened yet, not itself surprising per-bucket). Live split:

:::census empty-scaffolding

**Lifecycle 4 · Instance Configuration Document (ICD)**

- **Definition** — THE operational subchunk — an instance's parameters + process + data.

- **Detection signature** — title "Single Instance Configuration Document" (×48) or named variants ("Amatsu Instance Configuration Document"); `instance_of` edges (196 instances: 114 allocation-system, 13 distribution-reward, 9 integration-boost, 8×8 per-prime singletons, 3 pioneer-chain, 1 core-governance).

- **Relationships** — contains Parameters (Quantities 1), Operational Process Definition (Process 1), Data Repository (Lifecycle 6).

**Lifecycle 5 · Invocations**

- **Definition** — in-flight runs of an instance.

- **Detection signature** — `invoked_by` (201) / `invocation_of` (5) edges; "In Progress Invocations" dirs.

- **Members** — 5 tracked invocation entities (4 distribution-reward, 1 integration-boost).

**Lifecycle 6 · Data Repository triad**

- **Definition** — per-instance record-keeping: Initial Planning → Operational GovOps Review → Artifact Edit Proposal.

- **Detection signature** — exact title triple (×83 each). **Discovery: 83 "Artifact Edit Proposal" docs are per-instance edit-history stubs living INSIDE artifacts** — a distributed change-log, distinct from the Root Edit pipeline (agents' Instruments group covers the distinction).

**Lifecycle 7 · Omni Documents** [evidence level 2 · source-read]

- **Definition** — each agent's idiosyncratic non-primitive content — the ANTI-template (everything the primitive machine doesn't standardize).

- **Detection signature** — title "Omni Documents" (8 roots, one per prime, `<prime>.3`). Spark's exemplars: Governance Information (forums/Discord/delegation/risk council/emergency), Inherited Sky Core infrastructure, Ecosystem Accord references, SubProxy management, Savings configuration, Strategic Investments, Arkis Infrastructure, Offchain Collateralized Lending, Risk Curation Framework, **"Confidential Strategic Integrations and Deployments"** (a declared opacity zone — analyst flag). Weight: Spark 428 docs vs Keel 8 — Omni size tracks business complexity, not template.

- **Relationships** — where Actors 1 role wiring + Instruments 6 delegation + Process 5 emergency get agent-specific overrides; SRC Membership Registry lives here (Registries 1).

### Procedural concepts

*[evidence level 1 · censused] — title-template counts, processes.json, and cite-hub counts are script-censused.*

**Process 1 · Operational Process Definitions**

- **Definition** — an instance's step-by-step operating procedure.

- **Detection signature** — title (×96) + child protocol triple.

- **Spread** — all 8 primes (17/11/15/ 24/7/7/8/7 across primes 1–8).

- **Relationships** — contains Process 2.

**Process 2 · Routine / Non-Routine / Emergency Protocol triple**

- **Definition** — the three-tier response taxonomy every process carries.

- **Detection signature** — exact titles (×60 each).

- **Relationships** — the Emergency tier links to the Emergency Response System (Process 5).

**Process 3 · Curated Process Inventory**

- **Definition** — human-validated list of every step-by-step procedure.

- **Detection signature** — `public/processes.json` (132 processes, 8 categories: Settlement & Financial 45, Dispute & Emergency 20, Agent & Primitive Lifecycle 16, Collateral & Asset Mgmt 16, Personnel & Delegation 13, Executive & Spell 12, Governance & Voting Cycles 5, Artifact & Atlas Governance 5).

- **Relationships** — the category system is itself a validated concept taxonomy; members overlap Process 1/2 and the Instruments group.

**Process 4 · Governance Cycles**

- **Definition** — recurring cadences.

- **Detection signature** — articles `83edd4e1` /A.1.11 (weekly: operational + atlas-edit tracks), `7f2ba62c` /A.1.12 (monthly + calendar exceptions), `6f8d5065` /A.2.4 (monthly settlement).

- **Relationships** — cycles SCHEDULE instruments (votes, edits, settlements) defined elsewhere — pure cross-linkers.

**Process 5 · Emergency machinery**

- **Definition** — detection → signal → response pipeline.

- **Detection signature** — `emergency_response` edges (16); subtree `1d940c6d` /A.1.9; "Emergency Spells" `b8266c11` /A.1.10.5; Emergency Protocol tier (Process 2). Cross-link hub: `A.1.9.1.3.1 Emergency Response Signal Group` (13 cites) + `A.1.9.1.1 Definition Of Emergency Situations` (10 cites).

- **Spread** — A.1 core + every instance's emergency protocol.

**Process 6 · Numbered step procedures (raw)**

- **Definition** — docs whose content is a literal numbered sequence.

- **Relationships** — subset feeds Process 3; exemplars outside processes.json are candidates for its next triage (e.g. `A.1.6.4.4.1 AD Monthly Compensation Cycle`).

:::census numbered-step-docs

### Normative & instrument concepts

*Tier labels are per-item, one tier per tag, on each heading below. Instruments 1–8's
rule and numeric details were source-verified in the 2026-07-27 sweep (inline
`[evidence level 2 · source-read ✓]` marks); the Norms 1–9 block carries its own labels at its note.*

**The normative-family taxonomy** — *rewritten census-first 2026-07-27*
(concepts-audit.md rewrite item 1). The previous version of this block was the
normative-deep-dive agent's frame with corrected numbers bolted on; that agent's
counts were provably wrong (it claimed 200–400 Active Data Controllers against a
real 64), so the frame itself was re-derived rather than re-cited. Every family
below survived because a detection pass **actually run** over `public/docs.json`
+ `public/relations.json` found it; each carries its signature, its live count,
and one exemplar quoted verbatim from `vendor/next-gen-atlas/content/**` with a
UUID. Signatures and live counts are `[evidence level 1 · censused]` (censused, re-run per atlas
bump). Each family's exemplar quote is separately `[evidence level 2 · source-read]` (read from source
in this pass).

Seven of the nine title-derived families are wired to the standing
`normative-title-families` census below, so their counts re-run per atlas bump
instead of aging in prose.

**What did not survive the rewrite** — corrections stay visible:

- **Norms 5 (escalation & precedence) was demoted** to a labeled interpretation note
  (below Norms 9): no general mechanical signature exists. Title matching yields
  1 "Conflict Resolution" + 1 "Precedence Over Conflicting Provisions" + 3
  "Escalat*" docs (2 of them Risk-scope penalty triggers, a different sense);
  a content regex for precedence language (`takes precedence|shall prevail|
  supersedes`) returns 13 docs spanning at least three unrelated senses. That is
  a hand-curated pointer list, not a family, and it is now labeled as one.
- **Norms 3's inherited signature was wrong**, not just imprecise. "Global
  Activation Status docs (×140) + has_status edges (136)" measures the primitive
  lifecycle machine (the Lifecycle 2 group): every `has_status` edge runs from a primitive
  doc to *its own* "Global Activation Status" child, and 136 of the 141 `Suspen*`
  titles are the empty "Suspended Instances" lifecycle buckets already counted by
  the `empty-scaffolding` census. The real normative-suspension family is 5 docs.
- **Norms 1's "all sourced from A.1" was false** — corrected below from the full
  854-edge set (five scopes).
- **Norms 6's "Usage Standards (×22 docs)" was dropped from this family.** The 33
  live `Usage Standards` docs are per-multisig operating constraints (read:
  A.1.10.4.1.1.1 SparkLend Multisig Usage Standards — "The SparkLend Security
  Access Multisig can only be used in urgent or emergency situations"), i.e. the
  multisig/ICD layer, not actor conduct.
- **Norms 9's ADC claim was dropped**: the 64 Active Data Controllers are real (type
  census) but they are a stewardship fact (Duties 2), not an edit restriction. The
  unverified "immutability clause density ⚠" is replaced by the actual count.

**Norms 1 · Duties** — role-subject obligations.

- **Definition** — a sentence in which a named governance role is the subject of
  an obligation/authorization verb, materialized by the build pipeline as a
  `duty_for` edge from the role entity to the doc that states the duty.

- **Detection signature** *(one-off pass over `public/relations.json`; not
  censused — `conceptsCensus.ts` is docs-bundle-only by design)* — all edges with
  `e == "duty_for"`, grouped by the edge's `role_declared`/`match` metadata and
  by the scope of the source doc_no.

- **Members / Spread** — **854 edges over 635 distinct docs, held by 8 role
  entities**: Core Facilitator 199, Operational GovOps 171, Core GovOps 134,
  Facilitator 120, Operational Facilitator 105, Executor Agent 63, Operational
  Executor Agent 41, Core Executor Agent 21. Match kinds: active 705, passive 77,
  title 35, phrase 24, org 13. Scope spread A.1 347 · A.2 245 · A.6 181 · A.3 49 ·
  A.4 32 — **correcting the previous entry's claim that all 854 are sourced from
  A.1**, which was true only of the 322-edge sample it was read off.

- **Exemplar** — A.1.3.2.2 Review Obligation `907407a8-123f-47bd-a120-9ce8f15c6c48`
  (two duty_for edges: Core GovOps, Core Facilitator): *"Core GovOps, the Core
  Facilitator, and the Aligned Delegates must review modifications to Synome
  Documents made by the Synome Editor for conformance with the Atlas Documents…"*

- **Relationships** — the same edge set backs group Duties 1; the duty layer is what
  Norms 6 qualifies and Norms 7 adjudicates.

**Norms 2 · Prohibitions** — negated norms.

- **Definition** — a rule stated as a bar on conduct rather than a requirement.

- **Detection signature** — two passes, deliberately kept apart: **title**
  `/Prohibit/` (the docs the Atlas *names* as prohibitions) and **content**
  keyword (`prohibit(ed/s/ion)|forbidden|not permitted|may not`), the
  lower-precision reach measure. Both censused below.

- **Members / Spread** — 11 title-named prohibitions; two clusters: conduct bans
  in A.1.6/A.1.7 (kickbacks, counterparty engagement, GitHub-merge and
  post-deployment-suggestion bans in the spell pipeline) and the four structural
  "Prohibition On Deactivating …" rules under A.2.2.1.2.4.2.1 (Genesis, Executor
  Accord + Root Edit, Upkeep Rebate, Ecosystem Upkeep Fee primitives), plus two
  Risk exposure-limit prohibitions in A.3.2. The content census (~52 docs) is the
  wider, noisier reach.

- **Exemplar** — A.1.6.5 Kickbacks Prohibited
  `45e794a0-5092-4dea-a0de-6f373228f760`: *"Aligned Delegates are not allowed to
  provide "kickbacks" from their compensation to SKY holders who delegate to
  them. Violation of this requirement constitutes misalignment."*

- **Relationships** — breach of a Norms 2 rule is misalignment (Norms 8), routed to Norms 7.

:::census prohibition-language

**Norms 3 · Suspension state rules** — reversible removal.

- **Definition** — rules governing a *reversible* loss of operational capability
  (a status an actor or instance can return from). Distinct from Norms 4, which is
  permanent.

- **Detection signature** — title `/Suspen/` **minus** the lifecycle status-bucket
  titles (`Suspended Instances` etc., which are group-B scaffolding). Censused as
  the `suspension-rule` bucket below.

- **Members / Spread** — **5 docs**, in two senses: actor-side emergency
  suspension of an agent artifact (A.1.14.1.5.3 Intent to Suspend Notice Process,
  A.1.14.1.5.4.1/.2 Emergency Suspension Resolution / Review Process) and
  instance-side status definition (A.2.2.1.3.2.2 Suspended Instance Status), plus
  the one-off A.2.2.1.1.3.2.1 Short Term Suspension of "Founder Access" (also a
  Instruments 10 transitionary measure). The 140 `Global Activation Status` docs and 136
  `has_status` edges belong to the lifecycle machine (Lifecycle 2), not here.

- **Exemplar** — A.2.2.1.3.2.2 Suspended Instance Status
  `3e5de640-5bc2-4953-a233-913e3337b4bb`: *"The instance Status of `Suspended`
  indicates that an instance of a Primitive was `Active` at one point in time and
  may be `Active` again, but is not currently operational."*

- **Relationships** — the reversible counterpart of Norms 4; the instance sense is
  the Lifecycle 2 status vocabulary read normatively.

**Norms 4 · Derecognition machinery** — permanent removal.

- **Definition** — permanent removal of an actor from a governance role, and the
  notice/recording machinery around it.

- **Detection signature** — title `/Derecogni/` or `^Swift Action` (censused
  below); corroborated by `listed_in` edges into the derecognition registries in
  `relations.json`.

- **Members / Spread** — **14 title-named docs** spanning the whole path: the
  trigger ("Swift Action Is Required From Facilitators To Redress AC/AD
  Misalignment", A.1.5.8 and A.1.6.6 — an exact-title parallel pair), the
  mandated outcome (A.1.5.9.2.2 Mandated Derecognition For Severe Breaches, plus
  three "Promptly Derecognized — Mandated Timeline…" action tenets for AC, AD and
  Facilitator), the process (A.1.5.10 AC Derecognition → .1 Notice → .2
  Recording), the opsec-breach route (A.1.6.8, A.1.7.4) and two Needed Research
  gaps (NR-5 Derecognition Procedure, NR-9 Derecognition Uncertainty Due To
  Anonymous Actors). 30 docs mention derecognition in content. Registry evidence:
  11 `listed_in` edges into "Derecognized Alignment Conservers" (a live Active
  Data table, 11 dated rows 2023-06-08 → 2026-06-11, each with a forum reasoning
  post) and 9 into the "Aligned Delegate Breach Registry".

- **Exemplar** — A.1.5.10 AC Derecognition
  `ac998664-5b5e-4ea5-813b-dc3105ea6cf2`: *"Derecognition is the ultimate
  accountability measure for misalignment and entails permanently removing the
  individual or entity from their role as an Alignment Conserver. An
  individual/entity who has been derecognized from a Facilitator role is not
  eligible to serve as an Aligned Delegate, and vice versa."*

- **Relationships** — the only normative family with a populated outcome
  registry (Registries 1); reached from Norms 8 via Norms 7.

**Norms 6 · Conduct standards** — HOW-obligations.

- **Definition** — standards qualifying *how* a role must discharge its duties
  (care, secrecy, caution), as opposed to *what* it must do (Norms 1).

- **Detection signature** — title `/Operational Security/` or `/Err On (The)
  Side Of Caution/` (censused below).

- **Members / Spread** — **12 docs**. The core is a three-way parallel mandate
  running across the actor articles — A.1.5.7 (ACs: anonymity + high opsec),
  A.1.6.7 (ADs: mandate to maintain high opsec), A.1.7.3 (Facilitators: same) —
  each paired with its derecognition consequence (A.1.6.8, A.1.7.4) and, twice
  over, with an identically titled "Facilitators Must Err On Side Of Caution"
  (A.1.6.9 and A.1.7.5 — one of the cleanest cross-scope duplications in the
  corpus). Outliers: NR-4 (opsec protocols research track), A.2.9.1.3 (ecosystem
  actors), A.6.1.1.1.3.1.3.7.1 (Spark artifact).

- **Exemplar** — A.1.6.9 Facilitators Must Err On Side Of Caution
  `09efe31d-28ae-47cc-a81e-caf4f669df95`: *"Facilitators are required to err on
  the side of caution and take action whenever there is any real possibility that
  the operational security of an Aligned Delegate (AD) is compromised. …Abuse of
  this power is severe misalignment."*

- **Relationships** — qualifies Norms 1; its own abuse is a Norms 8 misalignment, closing
  a loop back into Norms 7.

**Norms 7 · Adjudication & proof** — the fact-finding layer.

- **Definition** — who decides whether a norm was breached, and to what standard.

- **Detection signature** — title `/Adjudicat/` or `/Standard of Proof/`
  (censused below); subtree size read from `docs.json`.

- **Members / Spread** — **5 title-named docs** over a 13-doc subtree: A.1.5.9
  Adjudication Process (the hub, with A.1.5.9.2.1 Graduated Response Framework
  For Breaches By Aligned Delegates, A.1.5.9.2.2 Mandated Derecognition For
  Severe Breaches, A.1.5.9.4 for when the Core Facilitator is himself the subject
  of an allegation), A.1.5.4 Standard of Proof, A.2.8.1.1.2.3.2 Adjudication By
  Core Facilitator (the dispute-resolution path, Instruments 8) — and **two identically
  titled Needed Research docs**, NR-1 and NR-8 "Systematic Basis Of Adjudication,
  Fact-Finding And Evidence": the Atlas records this layer as underspecified,
  twice.

- **Exemplar** — A.1.5.4 Standard of Proof In Universal Alignment Controversies
  `034a9ad7-5d4d-40db-bef8-cad80c0a01e2`, in full: *"Alignment Conservers are
  held to the highest standard when judging whether their actions are Universally
  Aligned."* (A one-sentence doc — worth noting against the previous entry's
  gloss "doubt resolved against the AC", which is a *reading* of the
  highest-standard rule plus its action tenet A.1.5.4.0.4.1, not Atlas text.)

- **Relationships** — the hinge between Norms 8/2 breach and Norms 4 outcome.

**Norms 8 · Alignment & misalignment** — the eligibility substrate.

- **Definition** — the Universal Alignment requirement and its negative,
  misalignment: the standard against which every other normative family is
  measured.

- **Detection signature** — title `/Universal Alignment/` or `/Misalign/`
  (censused below).

- **Members / Spread** — **22 docs, the widest normative family**, and unusually
  spread: definitional (A.0.1.1.4 Universal Alignment, .5 Assumption, .11
  Misalignment, .12 Slippery Slope Misalignment), requirement-setting (A.1.5.3,
  A.1.1.1 with the Spirit of the Atlas), procedural triggers scattered far from
  A.1.5 — A.1.11.2.3 Rejecting A Proposal For Misalignment, A.1.12.2.1.7.1
  Procedure For Blocking AEP For Misalignment, A.1.10.5.2.3.3.2 / A.1.10.5.3.2.3.2
  Misalignment To Vote For Unvalidated Standby / Emergency Drop Spell,
  A.1.14.1.5.4 Emergency Process For Misaligned Agent Artifacts — plus NR-17
  (misalignment of ecosystem actors: an acknowledged gap). 23 docs use the phrase
  "Universal Alignment" in content.

- **Exemplar** — A.1.5.3 Universal Alignment Requirements
  `403a05ce-f8e0-4ecf-8a56-026c0acd0d8a`: *"Alignment Conservers must operate
  only within the clearly delineated processes and frameworks of the Immutable
  Documents. ACs are strictly prohibited from colluding or secretly organizing to
  circumvent or undermine the Spirit of the Atlas. Any action of an Alignment
  Conserver that disrupts the governance dynamic of Sky is considered
  misalignment, as is any inaction that allows such violations to occur."*

- **Relationships** — the predicate every other family resolves to: Norms 2 violation
  "constitutes misalignment", Norms 6 abuse is "severe misalignment", Norms 4 is the
  "ultimate accountability measure for misalignment".

**Norms 9 · Edit restrictions** — gating who may modify an artifact.

- **Definition** — rules restricting artifact modification beyond the normal
  root-edit pipeline.

- **Detection signature** — title `/Edit Restrictions?/` (censused below).

- **Members / Spread** — **10 docs, all in A.6 agent artifacts**: the exact title
  "Artifact Edit Restrictions" appears once per agent artifact (8), of which two
  (Spark A.6.1.1.1 and Grove A.6.1.1.2) carry a child
  "Time-Limited Root Edit Restrictions On Removal Of Nested Contributors". Note
  the phrase never occurs in doc *content* — this family is title-shaped only.
  Adjacent but distinct: 5 `/Immutab/`-titled docs (A.1.2.2.1.1 Immutable
  Document Category and four action tenets stating Immutable Documents can be
  amended during the Endgame transition).

- **Exemplar** — A.6.1.1.1.2.2.2.2.1.2.1.6.1 Time-Limited Root Edit Restrictions
  On Removal Of Nested Contributors `cc60f445-1ed9-479e-9b44-00de9884a7b5`, in
  full: *"For a period of three years after June 4, 2025, any Artifact Edit that
  would have the effect of removing a Nested Contributor must be approved by a
  vote of SKY holders in addition to a vote of SPK holders to be effective."*
  (Dated and expiring — an Instruments 10-adjacent staleness signal.)

- **Relationships** — gates Instruments 3's Root Edit pipeline; Duties 2 stewardship is the
  mechanism, this is the norm.

:::census normative-title-families

**Norms 5 (demoted). Escalation & precedence — our pointer list, not a family.**
No mechanical signature survives (see "what did not survive" above), so this is
recorded as a curated four-doc pointer list, each title read: A.1.2.3 Conflict
Resolution `e883ceb7` (how contradictions between Atlas Documents are resolved),
A.0.1.2.1.2 Precedence Over Conflicting Provisions `fe58827d` (the Core Council
bootstrapping supremacy rule), A.1.3.1.4 Supremacy Of Atlas Documents `614e00fe`,
A.1.14.1.3 Pre-Eminence Of The Sky Core Atlas `0f55f573`. The Risk scope carries
its own unrelated escalation ladder (A.3.2.2.7.2.3 Escalation To Sky Governance +
Triggers For Escalation) — see the second-pipeline note below.

**Norms-hub note — OUR INTERPRETATION, NOT ATLAS STRUCTURE.** The families above
chain into what reads as a justice pipeline: eligibility/alignment (Norms 8) →
duties (Norms 1) qualified by conduct standards (Norms 6) → breach (Norms 2 violation,
misalignment) → adjudication (Norms 7) → suspension (Norms 3) or derecognition (Norms 4),
with precedence/escalation (the demoted Norms 5 pointers) as a routing layer. **The
Atlas nowhere presents these as one system** — no doc names a pipeline, no edge
type links the stages, and the chaining is our synthesis from the family
definitions, not a relay of Atlas text. What *is* Atlas text is the local
linkage: Norms 2 and 6 docs explicitly declare their breach "misalignment" (Norms 8),
Norms 6 and 4 docs explicitly route allegations to A.1.5.9 (Norms 7), and A.1.5.10
names derecognition "the ultimate accountability measure for misalignment". The
pipeline is a reasonable reading of those links; treat it as a reading.

**Second enforcement pipeline (found during this rewrite).** A structurally
parallel breach machinery exists in the Risk scope and is *not* part of the
actor-misalignment path above: A.3.2.2.7.2 runs Financial Penalties For Breach Of
Capital Requirements → Severity Of Breaches (Low/High definitions) → Length Of
Breaches → per-severity penalties → Additional Token Issuance → Restrictions On
Investments → Conservatorship, with its own escalation trigger (A.3.2.2.7.2.3
Escalation To Sky Governance). 30 docs in the A.3.2.2.7 subtree. Same shape —
breach definition, graduated response, terminal measure — different subject
(agent capital adequacy, not actor conduct) and different vocabulary (no
"misalignment", no adjudication).

**Instruments 1 · Ecosystem Accords** [evidence level 2 · source-read]

- **Definition** — bilateral/multi-party agreements between Sky Core and ecosystem parties, Atlas-recorded and governance-enforceable.

- **Detection signature** — title "Ecosystem Accord N: X And Y" under `be46648d` /A.2.8.2; `ecosystem_accord` edges (20). Members (all 10): 1 Grove&Spark `9ca40096`, 2 Prime Program (Spark/Moonbow/ Sky) `aa3b8e65`, 3 Keel `63a88b08`, 4 Obex `6bddc5aa`, 5 Core Council Executor Agent 1 `3aa58bdc`, 6 Osero `45125ff8`, 7 Skybase `8a74919c`, 8 Amatsu `9d187ae2`, 9 Ozone `cb3c159b`, 10 Grove `0cb00b28`. Anatomy claim [evidence level 2 · source-read ✓ 2026-07-27]: all 10 accord subtrees have exactly two children, titled "Accord Key Details" + "Accord Substantive Terms" (verified against the A.2.8.2.N index files). Signature caveat: Accord 2's own title is just "Prime Program", not "Ecosystem Accord 2: …" — the title-template signature misses it; use the subtree/edges.

- **Relationships** — governed by Dispute Resolution (Instruments 8); parties are composite_party entities; Accord 10 carries the Compensation Formula (Quantities 3).

**Instruments 2 · Executor Accords** [evidence level 2 · source-read]

- **Definition** — Prime↔Executor operational-insurance agreements — a PRIMITIVE, not a document-accord.

- **Detection signature** — primitive/instance subtype `executor-accord` (8+8); spec `88017877` /A.2.2.6.1.

- **Relationships** — **corrected 2026-07-27**: an earlier version called this a "mutual-exclusion rule with Root Edit (both cannot be deactivated)". The source rule (`a4797404` /A.2.2.1.2.4.2.1.2 Prohibition On Deactivating Executor Accord And Root Edit Primitives) is stronger and not a mutual exclusion: "Agents must have active Executor Accord and Root Edit Primitives at all times. Once Globally Activated, these Primitives cannot be deactivated" — i.e. *neither* may ever be deactivated individually; wind-down must go through the Agent Termination Protocol (Instruments 9) instead. Distinction vs Instruments 1: Instruments 1 binds parties bilaterally; Instruments 2 codifies an operational relationship inside the primitive machine.

**Instruments 3 · The edit-instrument triad** [evidence level 2 · source-read] — three same-sounding but distinct concepts:
- **Root Edit** (governance primitive): agent self-modification via token-holder
  vote; spec `78488c6b` /A.2.2.6.2; 8 instances; pipeline Submission → Expert
  Advisor Review → Facilitator Review → Token Holder Vote → Artifact Update, with
  Routine/Non-Routine/Emergency protocol variants and edit restrictions.
- **Artifact Edit Proposal (per-instance record, ×83)**: data-repo stub inside
  every ICD (Lifecycle 6) — the distributed change-log.
- **Atlas Edit Proposal (AEP, atlas-level)**: amendments to the core Atlas via the
  Atlas Edit Weekly/Monthly Cycle `14e99d92` /A.1.11.2 + `d2cbddd2` /A.1.12.2;
  mandatory template (A.1.12.2.3), Ratification Poll [evidence level 2 · source-read ✓ 2026-07-27] per
  `13e6da57` /A.1.12.2.6: "Duration: two (2) Weeks. Minimum Positive
  Participation: 240,000,000 SKY. Type: Binary Poll (yes/no/abstain)" — to pass,
  Yes must exceed No AND Yes vote-weight must exceed 240M SKY at close. Blocked
  AEPs cannot resubmit unchanged [evidence level 2 · source-read ✓ 2026-07-27]: "An AEP that was blocked for
  misalignment cannot be resubmitted in its original form; it must be edited
  before it can be formally submitted again to the Monthly Cycle" (Action Tenet
  `523bfc8f` /A.1.12.2.1.7.2.0.4.1; amend-and-resubmit path `90932951`
  /A.1.12.2.1.7.2).

**Instruments 4 · Voting machinery** [evidence level 2 · source-read]

- **Definition** — the consensus layer.

- **Detection signature** — Weekly Poll (A.1.11.1.2.1) → Executive Vote (A.1.11.1.2.2) → spell execution; Ratification Polls (Instruments 3); agent-token votes — Root Edit submission threshold [evidence level 2 · source-read ✓ 2026-07-27, refined]: the per-agent Root Edit instances require holding "at least 1% of the circulating token supply to submit a proposal" (Keel exemplar `98f59541` /A.6.1.1.3.2.2.2.2.1.2.1.1; an earlier version said ">1%" — the source says at-least, and it lives in the per-agent instances, not the A.2.2.6.2 spec, which only mandates that eligibility requirements exist); governance_channel edges (10).

- **Relationships** — cycles (Process 4) schedule it; spells (Instruments 5) execute it.

**Instruments 5 · Spell machinery** [evidence level 2 · source-read]

- **Definition** — executable governance actions.

- **Detection signature** — A.1.10.2 executive process subtree; Emergency Spells `b8266c11` /A.1.10.5 [evidence level 2 · source-read ✓ 2026-07-27]: Standby Spells (`5e40b575` /A.1.10.5.2 — "allow Sky Governance to bypass the GSM Pause Delay and directly perform crucial actions", reusable/re-executable) and Protego (`13cdbb75` /A.1.10.5.3 — "a contract that allows Sky Governance to cancel the execution of planned governance actions that are awaiting the expiration of the … GSM Pause Delay"), with Emergency Drop Spells governed under the Protego subtree (AD validation duties /A.1.10.5.3.2.3); Spell Validators = Aligned Delegates (validator_of edges, 27); Registered Spell Checklists registry (13 cites); StarGuard per-agent execution contracts (22 docs); Prime Spell Security Incidents log (Active Data).

- **Relationships** — emergency tier links Process 5; misvalidated emergency votes are AD breaches (→ normative layer).

**Instruments 6 · Delegation framework** [evidence level 2 · source-read]

- **Definition** — voting-power intermediation.

- **Detection signature** — aligned/ ranked_delegate_for edges (12/3); registries "List Of Recognized Aligned Delegates" + per-agent delegate lists (Spark A.6.1.1.1.3.1.3.8); delegate contracts (one per AD, annotated A.1.6.1.3.1.0.3.1); 6-month terms + conflict-of-interest disclosure [evidence level 2 · source-read ✓ 2026-07-27, ⚠ resolved — but note these are rules of *Spark's* delegate framework, not universal AD rules]: "Delegates are appointed by the Spark Foundation to fixed six (6) month terms aligned to calendar half-years" with automatic offboarding absent re-approval (`c612d4e4` /A.6.1.1.1.3.1.3.4.3 + `02deeacc` /.5.5); onboarding includes "conflict-of-interest collection" by the Spark Foundation (`d08b9b32` /A.6.1.1.1.3.1.3.4.1), and "Abstain" may be used "solely in cases where the Delegate has a documented conflict of interest for the specific proposal" (`16eb44b8` /A.6.1.1.1.3.1.3.3.4). Triggering rule (corrected 2026-07-22): a Weekly Cycle Proposal needs a Ranked Delegate with the Triggering Threshold in their AD Buffer at trigger time — and "It is inconsequential if, after triggering the Proposal, the Ranked Delegate loses their Ranked Delegate rank" (Action Tenet A.1.11.2.1.3.0.4.1; an earlier version of this entry inverted this into a rank-loss penalty — agent-derived error caught by source audit).

**Instruments 7 · Safe Harbor Agreement** [evidence level 2 · source-read]

- **Definition** — the one ON-CHAIN agreement instrument [evidence level 2 · source-read ✓ 2026-07-27]: contract `0xf17bB418B4EC251f300Aa3517Cb37349f17697A1` (verbatim at `0f541963` /A.2.11.1.2.2.2 Agreement Address); the `agreementURI` IPFS terms verbatim at `0064ee74` /A.2.11.1.2.2.3.1: `https://bafkreiernns2f4nv2uzvwtzjc2jboyivsu2mixz33y3xo7cvtllsuao6jy.ipfs.w3s.link/` ("The agreement located at the IPFS address shown in the smart contract … is the definitive version" — /A.2.11.1.2.1); fact page `258e85f5` /A.2.11.1.2.6 Agreement Fact Page. Distinction: immutable code vs governance-enforceable prose (Instruments 1).

**Instruments 8 · Dispute Resolution** [evidence level 2 · source-read]

- **Definition** — formal disagreement service for accords & terminations.

- **Detection signature** — `f4d827e9` /A.2.8.1 (intake → arguments → decision → recorded in Active Data "Dispute Resolutions"); conflict-resolution precedence rules `e883ceb7` /A.1.2.3; termination-dispute path A.1.14.5.4. Precedent count [evidence level 2 · source-read ✓ 2026-07-27]: exactly 1 recorded — the Active Data doc `c48614bb` /A.2.8.1.2.0.6.1 "Dispute Resolutions" lists a single entry, "Dispute Between Spark And Grove Regarding Effective Date Of Their Ecosystem Accord (September 2, 2025) - Facilitator Decision" — a young system.

**Instruments 9 · Agent Termination Protocol** [evidence level 3 · corroborated]

- **Definition** — structured agent wind-down.

- **Detection signature** — `fe833d0e` /A.1.14.5 (initiate via Root Edit vote → Executor executes → forum notice + residual assets → dispute path). Distinct from emergency suspension (Sky Core discretionary power, A.1.14.1.5.4).

**Instruments 10 · Transitional governance family** [evidence level 1 · censused] — three nested layers:
- **Short-Term Transitionary Measures** — interim workarounds pending permanent
  systems (forum-post AEP submission until Powerhouse; staking rewards pending
  treasury; Founder Access suspension…). Member list below.
- **Scope Bootstrapping** `ba97b4dd` /A.1.15: meta-authority to waive normal
  process during Endgame transition (precedence rule A.0.1.2.1.2).
- **Measures For Endgame Transition** `94ed62af` /A.3.7 (incl. the Tau/BEAM
  parameter hub, 18+14 cites).
All three are EXPIRY-implying — prime staleness-signal candidates.

:::census transitionary-measures

**Instruments 11 · Incubation frameworks** [evidence level 3 · corroborated]

- **Definition** — onboarding pipelines.

- **Detection signature** — Agent Incubation `bb0c23c6` /A.2.5, Ecosystem Actor Incubation `b09e86b1` /A.2.6, Integrator onboarding A.2.2.4.1.3 + Current/Onboarding Integrator registries (Registries 1), module onboarding checklists A.1.10.2.5.1.1.1.3, delegate onboarding (Instruments 6).

- **Relationships** — feeds Actors 1 actor roles; terminal state = Global Activation (Lifecycle 2).

**Instruments 12 · Pending transitions** [evidence level 1 · censused]

- **Definition** — tracked state-machine progressions.

- **Detection signature** — pending_transition edges (9, DB graph); Global Activation sequencing A.2.2.1.2.4.1.

- **Relationships** — lifecycle II.3 glue; overlaps Instruments 10 (expiry tracking).

**Instruments 0 · Locally-established seeds** (agents refine):
- **Prohibitions** — see the `prohibition-language` census under Norms 2 above.
  Exemplar: Kickbacks Prohibited `45e794a0` /A.1.6.5.
- **Normative-language mass** [evidence level 4 · unverified, not yet censused] — 1,301 docs carry MUST/SHALL/required-to language:
  the rulebook is ~12% of the corpus by doc count.
- **Spell machinery** — StarGuard: per-agent spell-whitelisting/execution contract
  (22 docs, A.1.10.2.3.2.3 subtree + per-artifact "StarGuard Max Delay" ×6 across
  A.1+A.6); Registered Spell Checklists registry (13 cites).
- **Transitionary measures** — "Short-Term Transitionary Measures" title family
  inside artifacts + root-edit pipelines; implies expiry review (staleness signal).

### Quantitative concepts

*[evidence level 1 · censused] — all five sub-groups are script-censused.*

**Quantities 1 · Parameter Sets**

- **Definition** — named tunable values grouped per instance/mechanism.

- **Detection signature** — title "Parameters" (×210), "Custom Instance Parameters" (×68), "Off-chain Operational Parameters" (×118), "Instance-specific Operational Parameters" (×20); Core Stability Parameters `86c75c9c` /A.3.1.2.

- **Spread** — overwhelmingly inside ICDs.

**Quantities 2 · Rate Limit family**

- **Definition** — flow-control constraints on allocation systems.

- **Detection signature** — titles "Rate Limits" (×129), Inflow (×54)/Outflow (×52)/Withdrawal (×43)/ Deposit (×41) + "Rate Limit IDs" (×104), "Inflow/Outflow RateLimitID" (×38 each).

- **Spread** — Spark (59) + Grove (51) dominate; A.4 (3).

- **Relationships** — nested in ICDs (Lifecycle 4); normative constraints (D) expressed as numbers (E).

**Quantities 3 · Formulas**

- **Definition** — mathematical definitions (LaTeX/inline math).

- **Members** — concentrated in `55999acf` /A.3.2 Risk Capital (probability-of-default model chain: Distance To Default, Leverage Adjusted Drift To Risk Ratio…), remainder: A.4.4 staking, A.2.8 accord compensation (e.g. `A.2.8.2.10.2.1.2 Compensation Formula`), spell validation math (A.1.10.2). Member list + exact split below.

- **Relationships** — formulas parameterized by Quantities 1 values.

:::census formula-docs

**Quantities 4 · On-chain object descriptors**

- **Definition** — address-bearing docs binding concepts to chain state.

- **Detection signature** — "Contract Addresses" (×125), "Token Address" (×106), "Underlying Asset Address" (×101), "Address" (×26); `has_address` edges (261 in relations, 278 in DB); addresses.atlas.json annotation layer.

- **Relationships** — bridges to the entity layer (F) and RedLens address artifacts.

**Quantities 5 · RRC Framework coverage**

- **Definition** — per-allocation-instance risk-model coverage status ("Covered"/"Pending") on the RRC Dashboard (expansion of "RRC" is not defined in-corpus — candidates: Risk & Regulatory Compliance / Relayer Role Configuration; flagged as an open question).

- **Detection signature** — title "RRC Framework Full Implementation" (×61: Spark 53, Grove 8) + "…Coverage" (×53); interim notice `A.2.2.10.1.1.3.2.1.1.2`.

- **Relationships** — a STATUS overlay on Lifecycle 4 instances — a validated staleness/coverage signal candidate.

### Programs & economic machinery (deep-dive merge)

*Tier labels are per-section, one tier per tag, on each heading below. The
2026-07-27 sweep (concepts-audit.md checks #1–2) source-verified Economics 3, 4,
8 and 9 — falsified claims carry visible correction notes (Economics 4 Step-3
split, Economics 8 Avalanche/Plasma rate limits). In [evidence level 3 · corroborated] sections, numbers not
carrying a ✓ remain leads.*

**Economics 1 · The four reward programs** [evidence level 3 · corroborated] — each is BOTH a named program and a primitive
(the Program-vs-Primitive blur is resolved: program = the incentive structure +
registries + partners; primitive = the per-agent deployment mechanism):
- **Distribution Reward**: 0.2%/yr on USDS held via a channel; spec `e632c38f`
  /A.2.2.9.1; 13 instances; integrator registries + reimbursement Active Data;
  its Routine Protocol is the Atlas's most-cited doc (Cite hubs).
- **Integration Boost**: SSR × unrewarded balance (dynamic, SSR-coupled — the
  key distinction from Distribution Reward's flat rate); spec `73577399`
  /A.2.2.9.2; 9 instances; mutually exclusive with SSR on the same balance.
- **Core Governance Reward**: pays primes for governance access provision — both
  incentive AND performance duty; spec `b22d1c08` /A.2.2.11.1; strategy is
  per-agent (not formula-driven), 1 instance so far.
- **Pioneer Chain**: launch-agent chain pioneering; spec `4c7be4c6` /A.2.2.9.3;
  3 instances — the least mature.

**Economics 2 · Capital deployment machinery** [evidence level 3 · corroborated] (supply side):
- **Allocation System** — THE dominant instance population (114 of 196): agents
  post Risk Capital, borrow USDS at Base Rate, deploy via per-chain "conduits"
  (Liquidity Layers, on-chain + off-chain param split, Relayer Role execution,
  rate-limit lattice Quantities 2); spec `9db14ab7` /A.2.2.10.1.
- **Risk Capital Rental** (`d8086dc0`) — inter-agent capital market: Junior
  (SEJRC) vs Originated Senior (OSRC) classes; driven by A.3.2 risk models.
- **ALM Rental** (`bd1f1ce5`) — trades the ALM *obligation* separately from
  capital: constraint-flexibility, not capital provision.

**Economics 3 · Rates family** [evidence level 2 · source-read] — SSR (`A.3.1.2.2`, BEAM-bounded 200–3000bps), legacy DSR,
SKY Borrow Rate (piecewise utilization curve — [evidence level 2 · source-read ✓ 2026-07-27] source-verified
at `05e97d4d` /A.4.4.1.3.5.1.2 Rate Setting Formula: two branches around Target
Utilization, `SKY Borrow Minimum Rate + Utilization / Target Utilization * Slope 1`
below/at target, `… + Slope 1 + (Utilization − Target Utilization) /
(1 − Target Utilization) * Slope 2` above), stUSDS Rate (a FORMULA, not a
parameter — [evidence level 2 · source-read ✓ 2026-07-27] verbatim at `7e51d5a7` /A.4.4.1.3.2: `stUSDS Rate
= Sky Savings Rate + (SKY Borrow Rate - SKY Borrow Minimum Rate) * Utilization -
Rfactor * f(Utilization)` — note the Rfactor deduction term the earlier
"SSR+borrow+utilization" gloss omitted). Distinction
locked: parameter (tunable coefficient) vs formula (immutable relationship) vs
mechanism (contract machinery paying it).

**Economics 4 · Revenue waterfall** [evidence level 2 · source-read] — Treasury Management `6c0af059` /A.2.3: Net Revenue
(Step 0) → allocation steps → Smart Burn Engine (Step 3) → Staking Rewards
(Step 4). Step-3 split [evidence level 2 · source-read ✓ 2026-07-27, corrected]: an earlier version said
"Step 3, 45%"; the source (`5ce73730` /A.2.3.1.2.4) actually allocates Step 3
Capital three ways — 45% SBE buybacks whose acquired SKY goes to stakers as SKY
Staking Rewards, 45% distributed to SKY stakers as USDS Staking Rewards, and
10% SBE buybacks that are burned. Kicker/splitter params [evidence level 2 · source-read ✓ 2026-07-27]
live at `ddb90fee` /A.3.5.2 Smart Burn Engine Parameters (current values:
`kicker.khump` −200M USDS, `kicker.kbump` 6,000 USDS, `splitter.hop` 13,787 s;
100% of Splitter allocation accumulates SKY, 0% rewards stakers directly,
`burn` 100%). SPLITTER_MOM breaker exempt from GSM delay [evidence level 2 · source-read ✓ 2026-07-27]:
verbatim at `5247c795` /A.1.10.3.2.8 — "The SPLITTER_MOM contract allows for
the disabling of the Smart Burn Engine without the GSM Pause Delay" (its
activation also disables USDS Staking Rewards until reversed);
operationalized by the Monthly Settlement Cycle (dual independent calculation +
reconcile + true-up — an audit-shaped procedure) and tuned by the Operational
Weekly Cycle. Surplus Buffer /A.3.5.1 is the state variable the waterfall reads.

**Economics 5 · Fee/rebate loop** [evidence level 3 · corroborated] — Ecosystem Upkeep Fee (uniform, ∝ token supply) +
Upkeep Rebate (cross-holding incentive: A holding B's tokens claims rebate) —
an INTER-AGENT cost-sharing mechanism, unlike user-facing rewards (Economics 1).

**Economics 6 · Budgets** [evidence level 1 · censused]

- **Definition** — named spending authorities with accrual/contingency rules.

- **Detection signature** — title contains "Budget" — 24 docs, censused: tiered Ranked Delegate budgets (400k/175k/48k USDS/yr L1/L2/L3), Resilience Fund (5M/yr), Resilience Research (≤2M), Bug Bounty rewards budget, Liquidity Bootstrapping transfers (2M + 2.4M to Spark), and **three 0-USDS placeholder budgets** (Governance Process Support, Communications Infrastructure, Accessibility) — dormant-concept signal. Refines Meta 1: the Budget Controller/Directory/Document TYPES are unused, but budgeting operates through plain Core docs — spec'd formalism abandoned, practice ad hoc. NR-10 ("AD Budget Management") shows the Atlas knows.

**Economics 7 · Insurance & defense** [evidence level 3 · corroborated] — Resilience Fund `ccd36a29` /A.2.9.1.1.1
(technical committee, application → approval → payout from Surplus Buffer);
distinct from treasury (allocation) and grants (capacity-building transfers —
Ecosystem Entity Grants /A.2.13 with recorded Aug-2025 disbursements + tx
hashes). Grant vs Reward distinction: one-time capacity transfers vs per-user
incentive flows.

**Economics 8 · Peg & bridge machinery** [evidence level 2 · source-read] — Lite PSM [evidence level 2 · source-read ✓ 2026-07-27]: `tin` 0%, `tout`
0%, `buf` 800,000,000 **DAI** (verbatim at `8694e11a` /A.3.3.2.7.1.1.2 Parameter
Values — the unit is DAI, not USDS); "Control of the Lite PSM is being
transitioned to Grove" (`39473e1a` /A.3.3.2.7.1.1 — an earlier version said
"per Accord terms", but the Grove accord subtree A.2.8.2.10 does not mention the
PSM; the transition is stated in the ALM article itself). SkyLink bridges per
chain with rate limits: Solana 5,000,000 USDS/day, "gradually increased over
time as the bridge becomes more mature" ([evidence level 2 · source-read ✓ 2026-07-27] verbatim at
`8414b48b` /A.4.2.2.2.3.2.2). **Correction (2026-07-27)**: an earlier version
claimed Avalanche/Plasma were "initially unlimited" — the current source says
otherwise: Avalanche's USDS rate limit is **0 USDS per day** (`6d550b28`
/A.4.2.2.3.3.2.2) and Plasma's is **5,000,000 USDS per day** (`527a2195`
/A.4.2.2.4.3.2.2); both are Core-Facilitator-modifiable via the Operational
Weekly Cycle without a prior Governance Poll. Plus Freezer multisigs (Actors 2);
Token SkyLink primitive for pioneer launches.

**Economics 9 · Risk model framework** [evidence level 2 · source-read] — A.3.2's quantitative core (54 math docs, Quantities 3):
implemented models (Lending Markets, Legal Recourse Assets) vs **Pending Risk
Models** (explicit backlog /A.3.2.1.1.4.3.2). Formula chain **corrected
2026-07-27**: an earlier version gave "PD → LGD → EAD → RWA → required capital", which
conflated two models — the Lending Markets chain (A.3.2.2.1.1.1.1.1 steps 1–5)
is actually PD → LGD → Asset Correlation Coefficient R → Capital Requirement
Without Buffers K → Instance Financial RRC, with EAD entering only at the final
step (`fc471b5a`: $\text{RRC} = K \times \frac{1}{CR} \times \text{EAD} \times
\text{ECR}$; LGD itself is `c9bd4928`: $LGD = min(1 - \frac{(1 - LP) * (1 -
S)}{LT}, 0)$), while Aggregate RWA belongs to the separate Real World Assets
RRC process (A.3.2.2.1.1.1.5.2, leverage-adjusted then × 8% capital ratio).
Smart Contract Risk Rating [evidence level 2 · source-read ✓ 2026-07-27] verbatim at `00fd9362`
/A.3.2.2.1.2.2: $\text{SCRR} = min[\text{CAP}, (\text{SR} + \text{CCR}) \times
\text{LAF} \times {AF}]$, with CAP currently `30` (`b824c6ec`) and the Lindy
Adjustment Factor (log-age discount, [evidence level 2 · source-read ✓ 2026-07-27] at `227eff62`
/A.3.2.2.1.2.2.4: $\text{LAF} = max(0, 1 - \frac{ln(1 + \lambda \times
\text{AGEeff})}{ln(1 + \lambda \times \text{max})})$) — the Atlas quantifies
contract maturity trust.

### Relational/social concepts (the entity layer)

*[evidence level 1 · censused] — entity/edge/role counts are script-censused.*

**Actors 1 · Actor role system**

- **Definition** — who may act in what capacity.

- **Detection signature** — entity types (11 agents, 3 facilitator_orgs, 2 govops_orgs, 13 delegate_orgs, 9 foundations, 6 dev companies, 10 composite parties, ~60 ecosystem actors incl. 7 bridge validators, 3 src_members) + role edges (prime_agent_for, *_facilitator_for, *_govops_for, aligned/ranked_delegate_for, erg_member_for, authorized_rep_for, holds_role_for, validator_of).

- **Relationships** — rulebooks for each role live in A.1 (actor rulebook chunks); operational assignments live in artifacts.

**Actors 2 · Multisig governance**

- **Definition** — the signer network.

- **Detection signature** — 31 multisig entities; edges signer_of (56), can_modify_signers_of (27); titles "Signers" (×21), "Required Number Of Signers" (×20), "Modification" (×25); registry `A.2.11.1.3.4.2 List Of Registered Multisigs`. Named family: SkyLink Freezer Multisigs per chain (Ethereum/ Solana/Avalanche/Plasma — each with a doc in A.1 AND A.4: cross-scope duplication). **Relayer Role** (×33 docs + 125 mentions): ALM multisig role within allocation instances, chain-suffixed (Mainnet/Base/Arbitrum…).

**Actors 3 · Funds-flow concepts**

- **Definition** — who pays whom.

- **Detection signature** — funds_transfer (23), funds_authorization (5), funds_data_gap (1) edges; payment-list registries (Registries 1).

- **Relationships** — agents' economic-flows findings merge here.

### Duties & responsibilities

*[evidence level 1 · censused] — duty_for/RP-edge counts are script-censused (see the accuracy correction on the relations.json point below).*

**Duties 1 · Duty assignments**

- **Definition** — obligations extracted per party.

- **Detection signature** — `duty_for` edges (build-graph §2s-ter) — 854 in the graph, and they DO ship in `relations.json` (an earlier version of this entry claimed otherwise — corrected), plus process_step_responsible_party_for (32), responsible_party_for (63/64).

- **Relationships** — RedLens reports (Op Facilitator / GovOps Responsibilities, OEA Assessment) are validated curations of this concept.

**Duties 2 · Active Data stewardship**

- **Definition** — mutable operational values with a designated controller.

- **Detection signature** — `type: Active Data` (76) + `Active Data Controller` (64) + active_data_for edges (76); structural suffix `.0.6.X`.

- **Spread** — **artifacts hold the majority (54 AD + 42 ADC)**; A.2 (13+13), A.1 (7+7), A.3 (2+2).

- **Relationships** — every registry (Registries 1) with live content is an Active Data doc; Updating Active Data procedure at `75e8fd51` /A.1.13.

### Registry concepts

*[evidence level 1 · censused] — the registry list and liveness split are script-censused (`:::census registry-liveness` below).*

**Registries 1 · Registries ("List Of …")**

- **Definition** — enumerable live collections the Atlas maintains.

- **Detection signature** — title prefix "List Of" (46 docs) + listed_in edges (47) + `.0.6.X` Active Data suffix on the live variants. Sub-families: - Party registries: Recognized Aligned Delegates, Derecognized Alignment Conservers (11 listed_in), AD Breach Registry, Authorized Forum Accounts (15), Active Arrangers, Registered Multisigs, SRC Membership Registry. - Program registries: Current/Onboarding Integrators, Integrator Applications, Distribution Reward Payments (×17 lists!), Integration Boost Payments (×10), Allocation Instances, Sky Direct Exposures, Auxiliary Accounts. - Governance registries: Interpretations, Registered Spell Checklists, Document Types, Top/Mid-Tier Audit Firms.

- **Relationships** — registries are where concepts MATERIALIZE as data — the payment lists are the terminal nodes of the Distribution Rewards concept chain.

**Registries 1-liveness** — no descendants, no data table, and no bulleted entries marks
a registry as an EMPTY shell rather than a LIVE one; the split typically
includes ALL/most Distribution Reward Payment lists, most Integration Boost
Payment lists, Integrator Applications, and Current/Onboarding Integrators
on the empty side. *(Atlas drift since db87434: List Of Active Arrangers
was empty at authoring time and has since gained live entries — it now
buckets "live", not "empty"; the census below reflects its current state.)*
**Insight: the Atlas's transactional record-keeping layer is largely
unrealized — payments are evidently tracked off-Atlas.** This is the
strongest staleness/emptiness signal found so far, sharper than the empty
instance-directory count. Live/empty split and full member list below
(re-run per atlas bump — a doc that gains real entries between passes, e.g.
an audit-firm list being populated, moves buckets here automatically).

:::census registry-liveness

### Cross-link hubs (most-cited docs — the concept anchors)

*[evidence level 1 · censused] — cite counts are script-censused (graph `cites` edges).*

| Cites | Doc |
|---|---|
| 22 | `A.2.2.9.1.2.4.1` Routine Protocol (Distribution Reward) — the single most-referenced doc in the Atlas |
| 19 | `A.2.2.9.1.2.1.3.3.1` Near-Term Process |
| 18 | `A.3.7.1.3.1.4.1` Tau Current Value |
| 14 | `A.3.7.1.3` Stability Parameter Bounded External Access Module |
| 13 | Emergency Response Signal Group · Registered Spell Checklists · Distribution Reward Primitive · Risk Capital Rental Primitive |
| 11 | Root Edit Primitive · Risk Capital |
| 10 | Definition Of Emergency Situations · Sky Primitives · Integration Boost Primitive · Core Governance Reward Primitive · Mainnet General Tracking Methodology · Default Admin Role (Keel) |

Reading: the Atlas's true "center of gravity" is the **Distribution Reward routine +
the stability-parameter access module + emergency signaling** — none of which is a
tree root.

---

## Part II — Indexes

### II.1 By scope (spread matrix — which concept kinds live where)

| Concept kind | A.0 | A.1 | A.2 | A.3 | A.4 | A.5 | A.6 artifacts | NR |
|---|---|---|---|---|---|---|---|---|
| Definitions (Meta 2) | ●56 | 16 | – | 9 | – | – | – | – |
| Type system (Meta 1) | – | ●30 | – | – | – | – | – | – |
| Annotations (Meta 5) | 2 | ●47 | 10 | 8 | – | – | 1 | – |
| Action Tenets (Meta 6) | 2 | ●28 | – | – | – | – | – | – |
| Scenarios (Meta 7) | – | ●9 | – | – | – | – | – | – |
| Primitive specs (Lifecycle 1) | – | – | ●15 | – | – | – | ×8 copies | – |
| ICDs/instances (Lifecycle 4) | – | – | few | – | – | – | ●196 | – |
| Process defs (Process 1/2) | – | – | schema | – | – | – | ●96 | – |
| Cycles (Process 4) | – | ●2 | 1 | – | – | – | – | – |
| Emergency (Process 5) | – | ●hub | – | – | – | – | protocols | – |
| Parameters (Quantities 1/2) | – | – | – | ●core | 3 | – | ●per-ICD | – |
| Formulas (Quantities 3) | – | ~5 | 2 | ●54 | 3 | – | – | – |
| Addresses (Quantities 4) | – | some | some | – | ●SkyLink | – | ●bulk | – |
| Active Data (Duties 2) | – | 7 | 13 | 2 | – | – | ●54 | – |
| Registries (Registries 1) | – | ●gov | ●program | 2 | – | – | ●payments | – |
| Needed Research (Meta 4) | – | – | – | – | – | – | – | ●12 |

(● = concentration site. The Accessibility Scope A.5 hosts essentially no
cross-cutting machinery — pure prose.)

### II.2 By detection signature type

- **Doc type**: Meta 1, 2 (via extraction), 4, 5, 6, 7, Duties 2.
- **Title template**: Lifecycle 2, 3, 4 (partly), 6, Process 1, 2, Quantities 1, 2, 5, Registries 1, StarGuard,
  Transitionary Measures, Relayer Role.
- **Edge type**: Lifecycle 4/5 (instance_of/invoked_by), Process 5 (emergency_response), Actors 1 (role
  edges), Actors 2 (signer edges), Actors 3 (funds edges), Duties 1 (duty_for, in relations.json), Duties 2
  (active_data_for), Registries 1 (listed_in), accords (ecosystem_accord).
- **Content pattern**: Quantities 3 (math), Instruments 0 prohibitions, Process 6 numbered steps, dated
  commitments (61 docs).
- **Curated**: Process 3 (processes.json), glossary.json, report modules (riskRules,
  activeDataIndex, rewardsIndex, facilitatorResponsibilities, oeaTasks).

### II.3 By lifecycle stage

spec (A.2.2 classes, Type Specifications) → activation (Global Activation Status
×140) → instance (ICDs ×196) → invocation (dirs ×144; 5 tracked) → records
(payment lists, Data Repository triad ×83) → archive (Archived/Failed/Suspended
dirs ×136; Archive Type spec'd but unused).

### II.4 Containment map (nesting, not tree)

- Distribution Rewards ⊃ {primitive spec, reward infrastructure rules, 13 instances,
  4 invocations, 17 payment registries, integrator registries, tracking
  methodologies, routine protocol (the #1 cite hub)}
- Agent Artifact ⊃ {15 primitive copies ⊃ hubs ⊃ ICDs ⊃ {parameters, process defs ⊃
  protocol triple, data repo triad}}, Omni Documents, StarGuard delay, RRC statuses
- Emergency machinery ⊃ {ERS article, signal group, emergency spells, per-process
  Emergency Protocols ×60, emergency_response edges}
- Multisig governance ⊃ {31 entities, signer/modify edges, Freezer family, Relayer
  Role, registries}
- Every ICD ⊂ both its primitive concept AND its host agent chunk (dual membership
  is the norm, not the exception)

### II.5 Validation cross-check: curated process categories ↔ concept groups

The 132 curated processes (Process 3) map onto this catalog cleanly — evidence the
concept taxonomy and the human-validated process taxonomy agree:

| processes.json category (n) | Concept groups |
|---|---|
| Settlement & Financial (45) | Process 4 settlement cycle · Actors 3 funds flows · E-money mechanisms (agent report pending) |
| Dispute & Emergency (20) | Process 5 emergency · Instruments 8 dispute resolution · Norms 5 escalation |
| Agent & Primitive Lifecycle (16) | Lifecycle 1–6 lifecycle · Instruments 9 termination · Instruments 11 incubation |
| Collateral & Asset Management (16) | Quantities 2 rate limits · allocation systems · RWA/arrangers |
| Personnel & Delegation (13) | Instruments 6 delegation · Actors 1 roles · Norms 3/4 suspension/derecognition |
| Executive & Spell Processes (12) | Instruments 5 spell machinery |
| Governance & Voting Cycles (5) | Process 4 cycles · Instruments 4 voting |
| Artifact & Atlas Governance (5) | Instruments 3 edit-instrument triad |

### II.6 Cross-scope concept duplication (same concept, parallel docs)

*[evidence level 1 · censused] — the census below (mechanical set-diff).*

*[evidence level 2 · source-read] — the curated exemplars, hand-picked and read from the census output.*

Hand-picked exemplars, all present in the full census below: SkyLink Freezer
Multisigs (one doc per chain in the A.1 governance view, its exact-title
counterpart in the A.4 protocol view — e.g. Ethereum SkyLink Freezer Multisig
at `A.1.10.3.2.14`/`A.4.2.2.1`, and likewise for Solana/Avalanche/Plasma);
Role Of Core Facilitator (three exact-title copies across A.1/A.2 —
`A.1.5.1.1`, `A.2.8.1.1.1.2`, `A.2.10.1.1`); Core Executor Facilitator
(A.1.7 sections mirrored in A.6.1.2 executor artifacts).

**Census tier only, deliberately not a graph edge** — title identity is a
lead, not a verified relation (it can't distinguish "same object, two views"
from "same template, different subjects"), and graph edges must assert true
relationships. The full member list below includes template-title noise
("Scope", "In General", "Resources") alongside the real exemplars — spot-check
before treating any pair as a confirmed duplication. Some catalog examples
from an earlier pass are excluded by the signature's noise filters and so
don't appear below: "Swift Action…" misalignment-redress (A.1.5.8/A.1.6.6
carry different exact titles — "AC" vs "AD" Misalignment — so they don't
title-match), and Sky Primitives (occurs 10 times across the corpus, over
the signature's ≤3-occurrence cap meant to exclude generic template titles).

:::census cross-scope-duplication

---

### II.7 Topics (A–Z → section)

Alphabetical list of topic names/aliases mapping to the concept unit(s) or
section that cover them — a recategorization/alias layer over the catalog,
not a precise index. Most entries point at one specific concept unit; a few
("Policies/Rules → Norms 1–9", "Procedures → Process 1–3") span a whole
family and link once to that family's section heading instead of a single
unit — "Agent Artifacts → Lifecycle (II.4)" is the same case (a legacy
section code standing in for the whole Lifecycle family, not one unit).
"Agent Tokens → Economics 1/A.4.5" is the one entry with a genuinely
unresolved half: `A.4.5` is a bare doc_no, not a catalog anchor.

:::index
- Accords (Ecosystem) → Instruments 1
- Accords (Executor) → Instruments 2
- Action Tenets → Meta 6
- Active Data → Duties 2
- Adjudication → Norms 7
- Agent Artifacts → Lifecycle (II.4)
- Agent Termination → Instruments 9
- Agent Tokens → Economics 1/A.4.5
- Aligned Delegates → Instruments 6
- Alignment/Eligibility → Norms 8
- Allocation Systems → Economics 2
- ALM & Rental → Economics 2
- Annotations → Meta 5
- Artifact Edit Proposals (per-instance) → Instruments 3/Lifecycle 6
- Atlas Edit Proposals → Instruments 3
- Budgets → Economics 6
- Bridges/SkyLink → Economics 8
- Compensation formulas → Quantities 3/Economics 3
- Conduct standards → Norms 6
- Core Governance Reward → Economics 1
- Cycles (weekly/monthly/settlement) → Process 4/Economics 4
- Data Repositories → Lifecycle 6
- Definitions → Meta 2
- Delegation → Instruments 6
- Derecognition → Norms 4
- Dispute Resolution → Instruments 8
- Distribution Rewards → Economics 1
- Duties → Norms 1/Duties 1
- Emergency machinery → Process 5/Instruments 5
- Executor Agents → Actors 1 (ghost layer)
- Fees (Upkeep) → Economics 5
- Formulas → Quantities 3
- Foundations → Actors 1
- Glossary → Meta 2
- Governance votes → Instruments 4
- Grants → Economics 7
- Hubs (primitive) → Lifecycle 2
- ICDs/Instances → Lifecycle 4
- Incubation → Instruments 11
- Integration Boost → Economics 1
- Integrator Program → Economics 1/Registries 1
- Interpretations → Meta 3
- Invocations → Lifecycle 5
- Multisigs → Actors 2
- Needed Research → Meta 4
- Omni Documents → Lifecycle 7
- Parameters → Quantities 1
- Payment lists → Registries 1 (empty)
- Peg Stability Module → Economics 8
- Pending transitions → Instruments 12
- Pioneer Chain → Economics 1
- Policies/Rules → Norms 1–9
- Primitives → Lifecycle 1
- Procedures → Process 1–3
- Prohibitions → Norms 2
- Protocols (routine/emergency) → Process 2
- Rate Limits → Quantities 2
- Rates (SSR/DSR/stUSDS) → Economics 3
- Registries → Registries 1
- Relayer Role → Actors 2
- Resilience Fund → Economics 7
- Risk models → Economics 9/Quantities 3
- Root Edits → Instruments 3
- RRC coverage → Quantities 5
- Scenarios → Meta 7
- Smart Burn Engine → Economics 4
- Spells/StarGuard → Instruments 5
- Staking → Economics 3/Economics 4
- Suspension → Norms 3
- Transitionary measures → Instruments 10
- Treasury waterfall → Economics 4
- Type Specifications → Meta 1
- Usage Standards → Norms 6
:::endindex

## Part III — Distinctions & open questions

**Distinctions refined so far** (agents extend):
- *Registry vs Active Data*: registries are the CONCEPT (an enumerable collection);
  Active Data is the MECHANISM (mutable doc + controller). Live registries are AD;
  some AD is not a registry (single values like Tau Current Value).
- *Procedure vs Protocol vs Cycle*: procedure = step sequence (Process 1/3); protocol =
  severity-tier variant of a procedure (Process 2); cycle = calendar scheduler that invokes
  procedures (Process 4).
- *Parameter vs Formula*: parameters are tunable inputs (Quantities 1/2, mostly per-ICD);
  formulas are relationships over them (Quantities 3, concentrated in A.3.2). The Stability
  Parameter BEAM (A.3.7.1.3) is the bridge: parameters with bounded external
  mutation rights.
- *Artifact Edit Proposal (per-instance record, ×83) vs Root Edit (governance
  instrument)*: same words, different concepts — the former is a data-repo stub, the
  latter a voted pipeline.

**Distinctions from the deep dives** (merged):
- *Accord vs Agreement vs Instrument vs Protocol*: accord = named bilateral doc,
  governance-enforceable; agreement = generic (can be on-chain code — Safe
  Harbor); instrument = anything that effects governance (primitives, spells,
  votes); protocol = system-level framework. Governance instruments bind
  decisions; operational instruments execute them.
- *Program vs Primitive*: a program is the incentive structure + partner/registry
  surface; the primitive is its per-agent deployment machine. The four reward
  programs are both at once; Treasury/Smart Burn are systems, NOT primitives
  (not instantiable).
- *Reward vs Grant vs Fee vs Budget*: per-user flow vs capacity transfer vs
  inter-agent cost share vs named spending authority.

**Dead ends so far**:
- "Tables" as a concept: only 11 markdown tables corpus-wide — table-ness is not a
  useful signature (Atlas encodes lists as doc trees instead).
- Doc `depth` as concept proxy: meaningless past 6 (heading cap).
- "Voting" as a standalone family: dissolves into cycles (Process 4) + instruments (Instruments 4/5) + duties; no coherent separate group.
- "Automated vs manual execution": a classification flag, not a concept — the
  normative question is who decides, which is a duty (Norms 1).
- Reward *normative* logic as separate family: distributes into duties, rate
  limits, scenarios — inseparable.

**Spec'd-but-unrealized concepts** (the "ghost layer" — strongest staleness set):
1. Budget Controller/Directory/Document doc types: unused (budgets run as Core
   docs, Economics 6).
2. Translation, Archive, Original Context Data, Facilitator Action Precedent,
   Navigation/Focus Hub types: no instances found.
3. All 26 reward payment registries: empty shells (Registries 1 census).
4. Three 0-USDS budgets (Economics 6).
5. Pending Risk Models backlog (Economics 9), Agent Token staking rewards (mentioned,
   unspecified), Purpose System funding (article exists, machinery thin).
6. Executor Agents overall: "not yet operational" per definition — 10-doc
   artifacts vs primes' hundreds.

**Open questions for the next pass**:
- ~~The 854 duty_for edges live only in the DB graph~~ RESOLVED: they ship in
  `relations.json` (build-graph §2s-ter) — an earlier version of this entry
  and two others in this doc (Duties 1, II.2) claimed otherwise; all three corrected.
- ~~Do the spec'd-but-unused doc types appear in atlas HISTORY?~~ RESOLVED
  (2026-07-28): never populated. A pickaxe search (`git log -G` on the heading
  `[Type]` tag) over the atlas repo's full history — all 209 commits back to the
  2025-05-28 root, monolithic-file and atomized eras alike — finds zero documents
  ever tagged with any of the 17 ghost types; the git root commit already carries
  their type specs, and the HTML-era reconstruction mentions them only as spec
  registry entries, never as instances. The ghost layer is aspirational
  scaffolding from the type system's original design, not residue of deleted
  content — a completeness signal, not a staleness one.
- ~~Payment lists (17+10) per reward instance: extractable into a Payments
  dataset?~~ RESOLVED (2026-07-28): nothing to extract — every one of the 27
  reward payment lists (17 Distribution Reward + 10 Integration Boost) contains
  only its lead-in sentence ("The … Payments are:") and zero entries. The lone
  Core Governance Reward Payments list defines the schema (Reward Period, Payee,
  Payment Address, Amount Paid, Transaction Hash, Transaction Date) but likewise
  holds no rows. The dataset is fully spec'd, empty corpus-wide; the
  registry-liveness census tracks these shells and will emit `[drift]` the
  moment rows appear — that is the trigger to revisit extraction.
- ~~"Near-Term Process" (19 cites)~~ RESOLVED: it's the interim Distribution Reward
  payment rule (Operational GovOps calculates; paid from Demand Side Buffer within
  7 days of month-end) — an Instruments 10-family transitional doc that 19 instance protocols
  cite. Its "near term" phrasing is undated → stale-date candidate.
- ~~Map Process 3's 8 curated categories onto the concept catalog as a
  validation pass.~~ RESOLVED: done — the mapping table is II.5, and its
  per-category counts (132 total: 45/20/16/16/13/12/5/5) re-verify exactly
  against the live `public/processes.json` (2026-07-28).

<!-- AGENT FINDINGS PENDING: normative layer · programs/economic flows · accords/instruments -->

---

## Legacy codes

This catalog used to label groups with single-letter (or two-letter) codes and
`[T1]`–`[T4]` tier tags. Both were replaced with word + number labels (2026-07-27)
because the codes were opaque. `docs/anatomy/concepts-audit.md` and
`docs/features/atlas-anatomy/LOG.md` are historical records and still use the
old codes — use this table to resolve their cross-references against the
current catalog.

Section II.7 was retitled from "Master index (A–Z, → group)" to "Topics (A–Z
→ section)" (2026-07-28) — the old name overclaimed precision for what is
really a topic/alias recategorization layer, not an index. The `II.7` number
itself is unchanged for cross-reference stability.

| Old code | New label |
|---|---|
| A | Meta |
| B | Lifecycle |
| C | Process |
| D | Instruments |
| Dn | Norms |
| E | Quantities |
| Ep | Economics |
| F | Actors |
| G | Duties |
| H | Registries |
| I | Cite hubs |

| Old tier tag | New label |
|---|---|
| `[T1]` | `[evidence level 1 · censused]` |
| `[T2]` | `[evidence level 2 · source-read]` |
| `[T3]` | `[evidence level 3 · corroborated]` |
| `[T4]` | `[evidence level 4 · unverified]` |
