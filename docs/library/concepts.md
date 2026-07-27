# Atlas Concept Catalog

The cross-cutting conceptual groupings of the Sky Atlas — the organization that does
NOT follow the tree. Mission + method: the `analyst-library` skill
(`.claude/skills/analyst-library/SKILL.md`). Signatures re-run live against the
checked-out atlas commit; prose interpretations are dated at the pass that wrote
them. Ten of the mechanical signatures below are backed by a standing drift
guard (`pnpm census:concepts`, `src/lib/conceptsCensus.ts`) — a `:::census
<slug>` block renders the live count + member list right in this doc instead
of a number frozen at whatever atlas commit last touched the prose.

**Epistemic labels** — every group below now carries a `[T1]`–`[T4]` tag (per
`docs/library/concepts-audit.md`'s rewrite plan). Each tag names exactly ONE
tier — never a combined `[T3/T4]`-style range; where one section mixes
evidence strengths, each span carries its own separate tag. The tier is the
strongest evidence backing that span: **[T1]** script-censused (re-run per atlas bump,
several wired to a live `:::census` block); **[T2]** source-read (an agent
verified the claim against the Atlas doc's verbatim content); **[T3]**
agent-derived, since corroborated (a subagent claim later checked and
confirmed); **[T4]** agent-derived, unverified (relayed from a subagent
report without an in-session read — treat as a lead, not a fact, until
checked). See concepts-audit.md for the full spot-check log this rubric is
based on.

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

### A. Meta-concepts (the Atlas describing itself)

*[T1] — doc-type counts, glossary extraction, NR-number gaps, and the ghost-type set difference are all script-censused.*

**A1. Document Type System**

- **Definition** — the Atlas's own vocabulary of 30 document types.

- **Detection signature** — `type: Type Specification`, all under `f65c083f` /A.1.2.2 (registry doc `A.1.2.2.2 List Of Document Types And Their Specifications`).

- **Members** — 30, all in A.1.

- **Relationships** — contains every overlay concept below; several spec'd types have no instances in the corpus (candidate staleness or future machinery) — the ghost/used split and full member list:

:::census ghost-doc-types

**A2. Definitions of Terms**

- **Definition** — canonical term definitions collected in Definitions sections.

- **Detection signature** — glossary extraction (direct [Core] children of `Definitions` sections) → `public/glossary.json`.

- **Members** — 81 terms from 3 sites: A.0 (56), A.1 (16), A.3 (9).

- **Relationships** — terms are used corpus-wide; definition sites are NOT where the concepts operate (e.g. "Distribution Reward" defined in A.0, operates in A.2/A.4/A.6).

**A3. Interpretations**

- **Definition** — recorded rulings on the Spirit of the Atlas.

- **Detection signature** — subtree of `55626fc2` /A.1.1.3 List Of Interpretations (+ its Active Data list).

- **Relationships** — registry pattern (H1); normative meta-layer.

**A4. Needed Research**

- **Definition** — open questions the Atlas assigns itself.

- **Detection signature** — `type: Needed Research`, `NR-X` doc_nos.

- **Members** — 12. **Discovery: NR numbering has gaps** (present: 1,2,3,4,5,7,8,9,10,12,17,18 — missing 6,11,13–16): items were resolved/removed; history could recover them.

- **Relationships** — two NRs share a title ("Systematic Basis Of Adjudication, Fact-Finding And Evidence" — NR-1, NR-8), linking to the Adjudication concept (D-group).

**A5. Annotations**

- **Definition** — commentary attached to elements.

- **Detection signature** — `type: Annotation` (structural suffix `.0.3.X`), `annotates` edges (101).

- **Spread** — A.1 (47), A.2 (10), A.3 (8), A.0 (2), artifacts (1) — concentrated on the Governance Scope.

**A6. Action Tenets & Precedents**

- **Definition** — behavioral directives for Facilitators.

- **Detection signature** — `type: Action Tenet` (`.0.4.X`).

- **Members** — 30 — only in A.0 (2) + A.1 (28).

- **Relationships** — the paired "Facilitator Action Precedent" type is spec'd but unpopulated (A1).

**A7. Scenarios**

- **Definition** — worked governance examples w/ variations.

- **Detection signature** — `type: Scenario`/`Scenario Variation` (`.1.X`, `.varX`).

- **Members** — 6+3, all in A.1.

### B. Lifecycle concepts (the primitive machine)

*[T1] — title-template and entity/instance counts are script-censused. (B7's contents are separately labeled on its heading.)*

**B1. Primitive** (class)

- **Definition** — reusable capability spec with hub/instances/ invocations lifecycle.

- **Detection signature** — entity_type `primitive` (15 subtypes × 8 agents = 120 entities); spec library at `fcde2604` /A.2.2.

- **Relationships** — contains B2–B6; instantiated per-agent in artifacts.

**B2. Primitive Hub Document**

- **Definition** — per-primitive per-agent status+directory root.

- **Detection signature** — title template. A representative sample of the exact-title families cited across this catalog (Primitive Hub Document, Global Activation Status, Hub Data Repository, Parameters, Rate Limits, the Data Repository triad, Omni Documents, the ICD title) is censused together:

:::census title-templates

- **Relationships** — contains B3 directories.

**B3. Instance Directories & Status Buckets**

- **Definition** — the Active/Completed/ In-Progress/Suspended/Failed/Archived containers.

- **Detection signature** — title templates (×130–144 each).

- **Relationships** — the empty ones are the validated staleness signal — most status-bucket directories are empty scaffolding (a state that hasn't happened yet, not itself surprising per-bucket). Live split:

:::census empty-scaffolding

**B4. Instance Configuration Document (ICD)**

- **Definition** — THE operational subchunk — an instance's parameters + process + data.

- **Detection signature** — title "Single Instance Configuration Document" (×48) or named variants ("Amatsu Instance Configuration Document"); `instance_of` edges (196 instances: 114 allocation-system, 13 distribution-reward, 9 integration-boost, 8×8 per-prime singletons, 3 pioneer-chain, 1 core-governance).

- **Relationships** — contains Parameters (E1), Operational Process Definition (C1), Data Repository (B6).

**B5. Invocations**

- **Definition** — in-flight runs of an instance.

- **Detection signature** — `invoked_by` (201) / `invocation_of` (5) edges; "In Progress Invocations" dirs.

- **Members** — 5 tracked invocation entities (4 distribution-reward, 1 integration-boost).

**B6. Data Repository triad**

- **Definition** — per-instance record-keeping: Initial Planning → Operational GovOps Review → Artifact Edit Proposal.

- **Detection signature** — exact title triple (×83 each). **Discovery: 83 "Artifact Edit Proposal" docs are per-instance edit-history stubs living INSIDE artifacts** — a distributed change-log, distinct from the Root Edit pipeline (agents' D-group covers the distinction).

**B7. Omni Documents** [T2]

- **Definition** — each agent's idiosyncratic non-primitive content — the ANTI-template (everything the primitive machine doesn't standardize).

- **Detection signature** — title "Omni Documents" (8 roots, one per prime, `<prime>.3`). Spark's exemplars: Governance Information (forums/Discord/delegation/risk council/emergency), Inherited Sky Core infrastructure, Ecosystem Accord references, SubProxy management, Savings configuration, Strategic Investments, Arkis Infrastructure, Offchain Collateralized Lending, Risk Curation Framework, **"Confidential Strategic Integrations and Deployments"** (a declared opacity zone — analyst flag). Weight: Spark 428 docs vs Keel 8 — Omni size tracks business complexity, not template.

- **Relationships** — where F1 role wiring + D6 delegation + C5 emergency get agent-specific overrides; SRC Membership Registry lives here (H1).

### C. Procedural concepts

*[T1] — title-template counts, processes.json, and cite-hub counts are script-censused.*

**C1. Operational Process Definitions**

- **Definition** — an instance's step-by-step operating procedure.

- **Detection signature** — title (×96) + child protocol triple.

- **Spread** — all 8 primes (17/11/15/ 24/7/7/8/7 across primes 1–8).

- **Relationships** — contains C2.

**C2. Routine / Non-Routine / Emergency Protocol triple**

- **Definition** — the three-tier response taxonomy every process carries.

- **Detection signature** — exact titles (×60 each).

- **Relationships** — the Emergency tier links to the Emergency Response System (C5).

**C3. Curated Process Inventory**

- **Definition** — human-validated list of every step-by-step procedure.

- **Detection signature** — `public/processes.json` (132 processes, 8 categories: Settlement & Financial 45, Dispute & Emergency 20, Agent & Primitive Lifecycle 16, Collateral & Asset Mgmt 16, Personnel & Delegation 13, Executive & Spell 12, Governance & Voting Cycles 5, Artifact & Atlas Governance 5).

- **Relationships** — the category system is itself a validated concept taxonomy; members overlap C1/C2 and D-group instruments.

**C4. Governance Cycles**

- **Definition** — recurring cadences.

- **Detection signature** — articles `83edd4e1` /A.1.11 (weekly: operational + atlas-edit tracks), `7f2ba62c` /A.1.12 (monthly + calendar exceptions), `6f8d5065` /A.2.4 (monthly settlement).

- **Relationships** — cycles SCHEDULE instruments (votes, edits, settlements) defined elsewhere — pure cross-linkers.

**C5. Emergency machinery**

- **Definition** — detection→signal→response pipeline.

- **Detection signature** — `emergency_response` edges (16); subtree `1d940c6d` /A.1.9; "Emergency Spells" `b8266c11` /A.1.10.5; Emergency Protocol tier (C2). Cross-link hub: `A.1.9.1.3.1 Emergency Response Signal Group` (13 cites) + `A.1.9.1.1 Definition Of Emergency Situations` (10 cites).

- **Spread** — A.1 core + every instance's emergency protocol.

**C6. Numbered step procedures (raw)**

- **Definition** — docs whose content is a literal numbered sequence.

- **Relationships** — subset feeds C3; exemplars outside processes.json are candidates for its next triage (e.g. `A.1.6.4.4.1 AD Monthly Compensation Cycle`).

:::census numbered-step-docs

### D. Normative & instrument concepts

*Tier labels are per-item, one tier per tag, on each heading below. D1–D8's
rule and numeric details were source-verified in the 2026-07-27 sweep (inline
`[T2 ✓]` marks); the Dn1–Dn9 block carries its own labels at its note.*

**The normative-family taxonomy** — *rewritten census-first 2026-07-27*
(concepts-audit.md rewrite item 1). The previous version of this block was the
normative-deep-dive agent's frame with corrected numbers bolted on; that agent's
counts were provably wrong (it claimed 200–400 Active Data Controllers against a
real 64), so the frame itself was re-derived rather than re-cited. Every family
below survived because a detection pass **actually run** over `public/docs.json`
+ `public/relations.json` found it; each carries its signature, its live count,
and one exemplar quoted verbatim from `vendor/next-gen-atlas/content/**` with a
UUID. Signatures and live counts are `[T1]` (censused, re-run per atlas
bump). Each family's exemplar quote is separately `[T2]` (read from source
in this pass).

Seven of the nine title-derived families are wired to the standing
`normative-title-families` census below, so their counts re-run per atlas bump
instead of aging in prose.

**What did not survive the rewrite** — corrections stay visible:

- **Dn5 (escalation & precedence) was demoted** to a labeled interpretation note
  (below Dn9): no general mechanical signature exists. Title matching yields
  1 "Conflict Resolution" + 1 "Precedence Over Conflicting Provisions" + 3
  "Escalat*" docs (2 of them Risk-scope penalty triggers, a different sense);
  a content regex for precedence language (`takes precedence|shall prevail|
  supersedes`) returns 13 docs spanning at least three unrelated senses. That is
  a hand-curated pointer list, not a family, and it is now labeled as one.
- **Dn3's inherited signature was wrong**, not just imprecise. "Global
  Activation Status docs (×140) + has_status edges (136)" measures the primitive
  lifecycle machine (group B2): every `has_status` edge runs from a primitive
  doc to *its own* "Global Activation Status" child, and 136 of the 141 `Suspen*`
  titles are the empty "Suspended Instances" lifecycle buckets already counted by
  the `empty-scaffolding` census. The real normative-suspension family is 5 docs.
- **Dn1's "all sourced from A.1" was false** — corrected below from the full
  854-edge set (five scopes).
- **Dn6's "Usage Standards (×22 docs)" was dropped from this family.** The 33
  live `Usage Standards` docs are per-multisig operating constraints (read:
  A.1.10.4.1.1.1 SparkLend Multisig Usage Standards — "The SparkLend Security
  Access Multisig can only be used in urgent or emergency situations"), i.e. the
  multisig/ICD layer, not actor conduct.
- **Dn9's ADC claim was dropped**: the 64 Active Data Controllers are real (type
  census) but they are a stewardship fact (G2), not an edit restriction. The
  unverified "immutability clause density ⚠" is replaced by the actual count.

**Dn1. Duties** — role-subject obligations.

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

- **Relationships** — the same edge set backs group G1; the duty layer is what
  Dn6 qualifies and Dn7 adjudicates.

**Dn2. Prohibitions** — negated norms.

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

- **Relationships** — breach of a Dn2 rule is misalignment (Dn8), routed to Dn7.

:::census prohibition-language

**Dn3. Suspension state rules** — reversible removal.

- **Definition** — rules governing a *reversible* loss of operational capability
  (a status an actor or instance can return from). Distinct from Dn4, which is
  permanent.

- **Detection signature** — title `/Suspen/` **minus** the lifecycle status-bucket
  titles (`Suspended Instances` etc., which are group-B scaffolding). Censused as
  the `suspension-rule` bucket below.

- **Members / Spread** — **5 docs**, in two senses: actor-side emergency
  suspension of an agent artifact (A.1.14.1.5.3 Intent to Suspend Notice Process,
  A.1.14.1.5.4.1/.2 Emergency Suspension Resolution / Review Process) and
  instance-side status definition (A.2.2.1.3.2.2 Suspended Instance Status), plus
  the one-off A.2.2.1.1.3.2.1 Short Term Suspension of "Founder Access" (also a
  D10 transitionary measure). The 140 `Global Activation Status` docs and 136
  `has_status` edges belong to the lifecycle machine (B2), not here.

- **Exemplar** — A.2.2.1.3.2.2 Suspended Instance Status
  `3e5de640-5bc2-4953-a233-913e3337b4bb`: *"The instance Status of `Suspended`
  indicates that an instance of a Primitive was `Active` at one point in time and
  may be `Active` again, but is not currently operational."*

- **Relationships** — the reversible counterpart of Dn4; the instance sense is
  the B2 status vocabulary read normatively.

**Dn4. Derecognition machinery** — permanent removal.

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
  registry (H1); reached from Dn8 via Dn7.

**Dn6. Conduct standards** — HOW-obligations.

- **Definition** — standards qualifying *how* a role must discharge its duties
  (care, secrecy, caution), as opposed to *what* it must do (Dn1).

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

- **Relationships** — qualifies Dn1; its own abuse is a Dn8 misalignment, closing
  a loop back into Dn7.

**Dn7. Adjudication & proof** — the fact-finding layer.

- **Definition** — who decides whether a norm was breached, and to what standard.

- **Detection signature** — title `/Adjudicat/` or `/Standard of Proof/`
  (censused below); subtree size read from `docs.json`.

- **Members / Spread** — **5 title-named docs** over a 13-doc subtree: A.1.5.9
  Adjudication Process (the hub, with A.1.5.9.2.1 Graduated Response Framework
  For Breaches By Aligned Delegates, A.1.5.9.2.2 Mandated Derecognition For
  Severe Breaches, A.1.5.9.4 for when the Core Facilitator is himself the subject
  of an allegation), A.1.5.4 Standard of Proof, A.2.8.1.1.2.3.2 Adjudication By
  Core Facilitator (the dispute-resolution path, D8) — and **two identically
  titled Needed Research docs**, NR-1 and NR-8 "Systematic Basis Of Adjudication,
  Fact-Finding And Evidence": the Atlas records this layer as underspecified,
  twice.

- **Exemplar** — A.1.5.4 Standard of Proof In Universal Alignment Controversies
  `034a9ad7-5d4d-40db-bef8-cad80c0a01e2`, in full: *"Alignment Conservers are
  held to the highest standard when judging whether their actions are Universally
  Aligned."* (A one-sentence doc — worth noting against the previous entry's
  gloss "doubt resolved against the AC", which is a *reading* of the
  highest-standard rule plus its action tenet A.1.5.4.0.4.1, not Atlas text.)

- **Relationships** — the hinge between Dn8/Dn2 breach and Dn4 outcome.

**Dn8. Alignment & misalignment** — the eligibility substrate.

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

- **Relationships** — the predicate every other family resolves to: Dn2 violation
  "constitutes misalignment", Dn6 abuse is "severe misalignment", Dn4 is the
  "ultimate accountability measure for misalignment".

**Dn9. Edit restrictions** — gating who may modify an artifact.

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
  (Dated and expiring — a D10-adjacent staleness signal.)

- **Relationships** — gates D3's Root Edit pipeline; G2 stewardship is the
  mechanism, this is the norm.

:::census normative-title-families

**Dn5 (demoted). Escalation & precedence — our pointer list, not a family.**
No mechanical signature survives (see "what did not survive" above), so this is
recorded as a curated four-doc pointer list, each title read: A.1.2.3 Conflict
Resolution `e883ceb7` (how contradictions between Atlas Documents are resolved),
A.0.1.2.1.2 Precedence Over Conflicting Provisions `fe58827d` (the Core Council
bootstrapping supremacy rule), A.1.3.1.4 Supremacy Of Atlas Documents `614e00fe`,
A.1.14.1.3 Pre-Eminence Of The Sky Core Atlas `0f55f573`. The Risk scope carries
its own unrelated escalation ladder (A.3.2.2.7.2.3 Escalation To Sky Governance +
Triggers For Escalation) — see the second-pipeline note below.

**Dn-hub note — OUR INTERPRETATION, NOT ATLAS STRUCTURE.** The families above
chain into what reads as a justice pipeline: eligibility/alignment (Dn8) →
duties (Dn1) qualified by conduct standards (Dn6) → breach (Dn2 violation,
misalignment) → adjudication (Dn7) → suspension (Dn3) or derecognition (Dn4),
with precedence/escalation (the demoted Dn5 pointers) as a routing layer. **The
Atlas nowhere presents these as one system** — no doc names a pipeline, no edge
type links the stages, and the chaining is our synthesis from the family
definitions, not a relay of Atlas text. What *is* Atlas text is the local
linkage: Dn2 and Dn6 docs explicitly declare their breach "misalignment" (Dn8),
Dn6 and Dn4 docs explicitly route allegations to A.1.5.9 (Dn7), and A.1.5.10
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

**D1. Ecosystem Accords** [T2]

- **Definition** — bilateral/multi-party agreements between Sky Core and ecosystem parties, Atlas-recorded and governance-enforceable.

- **Detection signature** — title "Ecosystem Accord N: X And Y" under `be46648d` /A.2.8.2; `ecosystem_accord` edges (20). Members (all 10): 1 Grove&Spark `9ca40096`, 2 Prime Program (Spark/Moonbow/ Sky) `aa3b8e65`, 3 Keel `63a88b08`, 4 Obex `6bddc5aa`, 5 Core Council Executor Agent 1 `3aa58bdc`, 6 Osero `45125ff8`, 7 Skybase `8a74919c`, 8 Amatsu `9d187ae2`, 9 Ozone `cb3c159b`, 10 Grove `0cb00b28`. Anatomy claim [T2 ✓ 2026-07-27]: all 10 accord subtrees have exactly two children, titled "Accord Key Details" + "Accord Substantive Terms" (verified against the A.2.8.2.N index files). Signature caveat: Accord 2's own title is just "Prime Program", not "Ecosystem Accord 2: …" — the title-template signature misses it; use the subtree/edges.

- **Relationships** — governed by Dispute Resolution (D8); parties are composite_party entities; Accord 10 carries the Compensation Formula (E3).

**D2. Executor Accords** [T2]

- **Definition** — Prime↔Executor operational-insurance agreements — a PRIMITIVE, not a document-accord.

- **Detection signature** — primitive/instance subtype `executor-accord` (8+8); spec `88017877` /A.2.2.6.1.

- **Relationships** — **corrected 2026-07-27**: an earlier version called this a "mutual-exclusion rule with Root Edit (both cannot be deactivated)". The source rule (`a4797404` /A.2.2.1.2.4.2.1.2 Prohibition On Deactivating Executor Accord And Root Edit Primitives) is stronger and not a mutual exclusion: "Agents must have active Executor Accord and Root Edit Primitives at all times. Once Globally Activated, these Primitives cannot be deactivated" — i.e. *neither* may ever be deactivated individually; wind-down must go through the Agent Termination Protocol (D9) instead. Distinction vs D1: D1 binds parties bilaterally; D2 codifies an operational relationship inside the primitive machine.

**D3. The edit-instrument triad** [T2] — three same-sounding but distinct concepts:
- **Root Edit** (governance primitive): agent self-modification via token-holder
  vote; spec `78488c6b` /A.2.2.6.2; 8 instances; pipeline Submission → Expert
  Advisor Review → Facilitator Review → Token Holder Vote → Artifact Update, with
  Routine/Non-Routine/Emergency protocol variants and edit restrictions.
- **Artifact Edit Proposal (per-instance record, ×83)**: data-repo stub inside
  every ICD (B6) — the distributed change-log.
- **Atlas Edit Proposal (AEP, atlas-level)**: amendments to the core Atlas via the
  Atlas Edit Weekly/Monthly Cycle `14e99d92` /A.1.11.2 + `d2cbddd2` /A.1.12.2;
  mandatory template (A.1.12.2.3), Ratification Poll [T2 ✓ 2026-07-27] per
  `13e6da57` /A.1.12.2.6: "Duration: two (2) Weeks. Minimum Positive
  Participation: 240,000,000 SKY. Type: Binary Poll (yes/no/abstain)" — to pass,
  Yes must exceed No AND Yes vote-weight must exceed 240M SKY at close. Blocked
  AEPs cannot resubmit unchanged [T2 ✓ 2026-07-27]: "An AEP that was blocked for
  misalignment cannot be resubmitted in its original form; it must be edited
  before it can be formally submitted again to the Monthly Cycle" (Action Tenet
  `523bfc8f` /A.1.12.2.1.7.2.0.4.1; amend-and-resubmit path `90932951`
  /A.1.12.2.1.7.2).

**D4. Voting machinery** [T2]

- **Definition** — the consensus layer.

- **Detection signature** — Weekly Poll (A.1.11.1.2.1) → Executive Vote (A.1.11.1.2.2) → spell execution; Ratification Polls (D3); agent-token votes — Root Edit submission threshold [T2 ✓ 2026-07-27, refined]: the per-agent Root Edit instances require holding "at least 1% of the circulating token supply to submit a proposal" (Keel exemplar `98f59541` /A.6.1.1.3.2.2.2.2.1.2.1.1; an earlier version said ">1%" — the source says at-least, and it lives in the per-agent instances, not the A.2.2.6.2 spec, which only mandates that eligibility requirements exist); governance_channel edges (10).

- **Relationships** — cycles (C4) schedule it; spells (D5) execute it.

**D5. Spell machinery** [T2]

- **Definition** — executable governance actions.

- **Detection signature** — A.1.10.2 executive process subtree; Emergency Spells `b8266c11` /A.1.10.5 [T2 ✓ 2026-07-27]: Standby Spells (`5e40b575` /A.1.10.5.2 — "allow Sky Governance to bypass the GSM Pause Delay and directly perform crucial actions", reusable/re-executable) and Protego (`13cdbb75` /A.1.10.5.3 — "a contract that allows Sky Governance to cancel the execution of planned governance actions that are awaiting the expiration of the … GSM Pause Delay"), with Emergency Drop Spells governed under the Protego subtree (AD validation duties /A.1.10.5.3.2.3); Spell Validators = Aligned Delegates (validator_of edges, 27); Registered Spell Checklists registry (13 cites); StarGuard per-agent execution contracts (22 docs); Prime Spell Security Incidents log (Active Data).

- **Relationships** — emergency tier links C5; misvalidated emergency votes are AD breaches (→ normative layer).

**D6. Delegation framework** [T2]

- **Definition** — voting-power intermediation.

- **Detection signature** — aligned/ ranked_delegate_for edges (12/3); registries "List Of Recognized Aligned Delegates" + per-agent delegate lists (Spark A.6.1.1.1.3.1.3.8); delegate contracts (one per AD, annotated A.1.6.1.3.1.0.3.1); 6-month terms + conflict-of-interest disclosure [T2 ✓ 2026-07-27, ⚠ resolved — but note these are rules of *Spark's* delegate framework, not universal AD rules]: "Delegates are appointed by the Spark Foundation to fixed six (6) month terms aligned to calendar half-years" with automatic offboarding absent re-approval (`c612d4e4` /A.6.1.1.1.3.1.3.4.3 + `02deeacc` /.5.5); onboarding includes "conflict-of-interest collection" by the Spark Foundation (`d08b9b32` /A.6.1.1.1.3.1.3.4.1), and "Abstain" may be used "solely in cases where the Delegate has a documented conflict of interest for the specific proposal" (`16eb44b8` /A.6.1.1.1.3.1.3.3.4). Triggering rule (corrected 2026-07-22): a Weekly Cycle Proposal needs a Ranked Delegate with the Triggering Threshold in their AD Buffer at trigger time — and "It is inconsequential if, after triggering the Proposal, the Ranked Delegate loses their Ranked Delegate rank" (Action Tenet A.1.11.2.1.3.0.4.1; an earlier version of this entry inverted this into a rank-loss penalty — agent-derived error caught by source audit).

**D7. Safe Harbor Agreement** [T2]

- **Definition** — the one ON-CHAIN agreement instrument [T2 ✓ 2026-07-27]: contract `0xf17bB418B4EC251f300Aa3517Cb37349f17697A1` (verbatim at `0f541963` /A.2.11.1.2.2.2 Agreement Address); the `agreementURI` IPFS terms verbatim at `0064ee74` /A.2.11.1.2.2.3.1: `https://bafkreiernns2f4nv2uzvwtzjc2jboyivsu2mixz33y3xo7cvtllsuao6jy.ipfs.w3s.link/` ("The agreement located at the IPFS address shown in the smart contract … is the definitive version" — /A.2.11.1.2.1); fact page `258e85f5` /A.2.11.1.2.6 Agreement Fact Page. Distinction: immutable code vs governance-enforceable prose (D1).

**D8. Dispute Resolution** [T2]

- **Definition** — formal disagreement service for accords & terminations.

- **Detection signature** — `f4d827e9` /A.2.8.1 (intake → arguments → decision → recorded in Active Data "Dispute Resolutions"); conflict-resolution precedence rules `e883ceb7` /A.1.2.3; termination-dispute path A.1.14.5.4. Precedent count [T2 ✓ 2026-07-27]: exactly 1 recorded — the Active Data doc `c48614bb` /A.2.8.1.2.0.6.1 "Dispute Resolutions" lists a single entry, "Dispute Between Spark And Grove Regarding Effective Date Of Their Ecosystem Accord (September 2, 2025) - Facilitator Decision" — a young system.

**D9. Agent Termination Protocol** [T3]

- **Definition** — structured agent wind-down.

- **Detection signature** — `fe833d0e` /A.1.14.5 (initiate via Root Edit vote → Executor executes → forum notice + residual assets → dispute path). Distinct from emergency suspension (Sky Core discretionary power, A.1.14.1.5.4).

**D10. Transitional governance family** [T1] — three nested layers:
- **Short-Term Transitionary Measures** — interim workarounds pending permanent
  systems (forum-post AEP submission until Powerhouse; staking rewards pending
  treasury; Founder Access suspension…). Member list below.
- **Scope Bootstrapping** `ba97b4dd` /A.1.15: meta-authority to waive normal
  process during Endgame transition (precedence rule A.0.1.2.1.2).
- **Measures For Endgame Transition** `94ed62af` /A.3.7 (incl. the Tau/BEAM
  parameter hub, 18+14 cites).
All three are EXPIRY-implying — prime staleness-signal candidates.

:::census transitionary-measures

**D11. Incubation frameworks** [T3]

- **Definition** — onboarding pipelines.

- **Detection signature** — Agent Incubation `bb0c23c6` /A.2.5, Ecosystem Actor Incubation `b09e86b1` /A.2.6, Integrator onboarding A.2.2.4.1.3 + Current/Onboarding Integrator registries (H1), module onboarding checklists A.1.10.2.5.1.1.1.3, delegate onboarding (D6).

- **Relationships** — feeds F1 actor roles; terminal state = Global Activation (B2).

**D12. Pending transitions** [T1]

- **Definition** — tracked state-machine progressions.

- **Detection signature** — pending_transition edges (9, DB graph); Global Activation sequencing A.2.2.1.2.4.1.

- **Relationships** — lifecycle II.3 glue; overlaps D10 (expiry tracking).

**D0. Locally-established seeds** (agents refine):
- **Prohibitions** — see the `prohibition-language` census under Dn2 above.
  Exemplar: Kickbacks Prohibited `45e794a0` /A.1.6.5.
- **Normative-language mass** [T4, not yet censused] — 1,301 docs carry MUST/SHALL/required-to language:
  the rulebook is ~12% of the corpus by doc count.
- **Spell machinery** — StarGuard: per-agent spell-whitelisting/execution contract
  (22 docs, A.1.10.2.3.2.3 subtree + per-artifact "StarGuard Max Delay" ×6 across
  A.1+A.6); Registered Spell Checklists registry (13 cites).
- **Transitionary measures** — "Short-Term Transitionary Measures" title family
  inside artifacts + root-edit pipelines; implies expiry review (staleness signal).

### E. Quantitative concepts

*[T1] — all five sub-groups are script-censused.*

**E1. Parameter Sets**

- **Definition** — named tunable values grouped per instance/mechanism.

- **Detection signature** — title "Parameters" (×210), "Custom Instance Parameters" (×68), "Off-chain Operational Parameters" (×118), "Instance-specific Operational Parameters" (×20); Core Stability Parameters `86c75c9c` /A.3.1.2.

- **Spread** — overwhelmingly inside ICDs.

**E2. Rate Limit family**

- **Definition** — flow-control constraints on allocation systems.

- **Detection signature** — titles "Rate Limits" (×129), Inflow (×54)/Outflow (×52)/Withdrawal (×43)/ Deposit (×41) + "Rate Limit IDs" (×104), "Inflow/Outflow RateLimitID" (×38 each).

- **Spread** — Spark (59) + Grove (51) dominate; A.4 (3).

- **Relationships** — nested in ICDs (B4); normative constraints (D) expressed as numbers (E).

**E3. Formulas**

- **Definition** — mathematical definitions (LaTeX/inline math).

- **Members** — concentrated in `55999acf` /A.3.2 Risk Capital (probability-of-default model chain: Distance To Default, Leverage Adjusted Drift To Risk Ratio…), remainder: A.4.4 staking, A.2.8 accord compensation (e.g. `A.2.8.2.10.2.1.2 Compensation Formula`), spell validation math (A.1.10.2). Member list + exact split below.

- **Relationships** — formulas parameterized by E1 values.

:::census formula-docs

**E4. On-chain object descriptors**

- **Definition** — address-bearing docs binding concepts to chain state.

- **Detection signature** — "Contract Addresses" (×125), "Token Address" (×106), "Underlying Asset Address" (×101), "Address" (×26); `has_address` edges (261 in relations, 278 in DB); addresses.atlas.json annotation layer.

- **Relationships** — bridges to the entity layer (F) and RedLens address artifacts.

**E5. RRC Framework coverage**

- **Definition** — per-allocation-instance risk-model coverage status ("Covered"/"Pending") on the RRC Dashboard (expansion of "RRC" is not defined in-corpus — candidates: Risk & Regulatory Compliance / Relayer Role Configuration; flagged as an open question).

- **Detection signature** — title "RRC Framework Full Implementation" (×61: Spark 53, Grove 8) + "…Coverage" (×53); interim notice `A.2.2.10.1.1.3.2.1.1.2`.

- **Relationships** — a STATUS overlay on B4 instances — a validated staleness/coverage signal candidate.

### E+. Programs & economic machinery (deep-dive merge)

*Tier labels are per-section, one tier per tag, on each heading below. The
2026-07-27 sweep (concepts-audit.md checks #1–2) source-verified Ep3, Ep4,
Ep8 and Ep9 — falsified claims carry visible correction notes (Ep4 Step-3
split, Ep8 Avalanche/Plasma rate limits). In [T3] sections, numbers not
carrying a ✓ remain leads.*

**Ep1. The four reward programs** [T3] — each is BOTH a named program and a primitive
(the Program-vs-Primitive blur is resolved: program = the incentive structure +
registries + partners; primitive = the per-agent deployment mechanism):
- **Distribution Reward**: 0.2%/yr on USDS held via a channel; spec `e632c38f`
  /A.2.2.9.1; 13 instances; integrator registries + reimbursement Active Data;
  its Routine Protocol is the Atlas's most-cited doc (I).
- **Integration Boost**: SSR × unrewarded balance (dynamic, SSR-coupled — the
  key distinction from Distribution Reward's flat rate); spec `73577399`
  /A.2.2.9.2; 9 instances; mutually exclusive with SSR on the same balance.
- **Core Governance Reward**: pays primes for governance access provision — both
  incentive AND performance duty; spec `b22d1c08` /A.2.2.11.1; strategy is
  per-agent (not formula-driven), 1 instance so far.
- **Pioneer Chain**: launch-agent chain pioneering; spec `4c7be4c6` /A.2.2.9.3;
  3 instances — the least mature.

**Ep2. Capital deployment machinery** [T3] (supply side):
- **Allocation System** — THE dominant instance population (114 of 196): agents
  post Risk Capital, borrow USDS at Base Rate, deploy via per-chain "conduits"
  (Liquidity Layers, on-chain + off-chain param split, Relayer Role execution,
  rate-limit lattice E2); spec `9db14ab7` /A.2.2.10.1.
- **Risk Capital Rental** (`d8086dc0`) — inter-agent capital market: Junior
  (SEJRC) vs Originated Senior (OSRC) classes; driven by A.3.2 risk models.
- **ALM Rental** (`bd1f1ce5`) — trades the ALM *obligation* separately from
  capital: constraint-flexibility, not capital provision.

**Ep3. Rates family** [T2] — SSR (`A.3.1.2.2`, BEAM-bounded 200–3000bps), legacy DSR,
SKY Borrow Rate (piecewise utilization curve — [T2 ✓ 2026-07-27] source-verified
at `05e97d4d` /A.4.4.1.3.5.1.2 Rate Setting Formula: two branches around Target
Utilization, `SKY Borrow Minimum Rate + Utilization / Target Utilization * Slope 1`
below/at target, `… + Slope 1 + (Utilization − Target Utilization) /
(1 − Target Utilization) * Slope 2` above), stUSDS Rate (a FORMULA, not a
parameter — [T2 ✓ 2026-07-27] verbatim at `7e51d5a7` /A.4.4.1.3.2: `stUSDS Rate
= Sky Savings Rate + (SKY Borrow Rate - SKY Borrow Minimum Rate) * Utilization -
Rfactor * f(Utilization)` — note the Rfactor deduction term the earlier
"SSR+borrow+utilization" gloss omitted). Distinction
locked: parameter (tunable coefficient) vs formula (immutable relationship) vs
mechanism (contract machinery paying it).

**Ep4. Revenue waterfall** [T2] — Treasury Management `6c0af059` /A.2.3: Net Revenue
(Step 0) → allocation steps → Smart Burn Engine (Step 3) → Staking Rewards
(Step 4). Step-3 split [T2 ✓ 2026-07-27, corrected]: an earlier version said
"Step 3, 45%"; the source (`5ce73730` /A.2.3.1.2.4) actually allocates Step 3
Capital three ways — 45% SBE buybacks whose acquired SKY goes to stakers as SKY
Staking Rewards, 45% distributed to SKY stakers as USDS Staking Rewards, and
10% SBE buybacks that are burned. Kicker/splitter params [T2 ✓ 2026-07-27]
live at `ddb90fee` /A.3.5.2 Smart Burn Engine Parameters (current values:
`kicker.khump` −200M USDS, `kicker.kbump` 6,000 USDS, `splitter.hop` 13,787 s;
100% of Splitter allocation accumulates SKY, 0% rewards stakers directly,
`burn` 100%). SPLITTER_MOM breaker exempt from GSM delay [T2 ✓ 2026-07-27]:
verbatim at `5247c795` /A.1.10.3.2.8 — "The SPLITTER_MOM contract allows for
the disabling of the Smart Burn Engine without the GSM Pause Delay" (its
activation also disables USDS Staking Rewards until reversed);
operationalized by the Monthly Settlement Cycle (dual independent calculation +
reconcile + true-up — an audit-shaped procedure) and tuned by the Operational
Weekly Cycle. Surplus Buffer /A.3.5.1 is the state variable the waterfall reads.

**Ep5. Fee/rebate loop** [T3] — Ecosystem Upkeep Fee (uniform, ∝ token supply) +
Upkeep Rebate (cross-holding incentive: A holding B's tokens claims rebate) —
an INTER-AGENT cost-sharing mechanism, unlike user-facing rewards (Ep1).

**Ep6. Budgets** [T1]

- **Definition** — named spending authorities with accrual/contingency rules.

- **Detection signature** — title contains "Budget" — 24 docs, censused: tiered Ranked Delegate budgets (400k/175k/48k USDS/yr L1/L2/L3), Resilience Fund (5M/yr), Resilience Research (≤2M), Bug Bounty rewards budget, Liquidity Bootstrapping transfers (2M + 2.4M to Spark), and **three 0-USDS placeholder budgets** (Governance Process Support, Communications Infrastructure, Accessibility) — dormant-concept signal. Refines A1: the Budget Controller/Directory/Document TYPES are unused, but budgeting operates through plain Core docs — spec'd formalism abandoned, practice ad hoc. NR-10 ("AD Budget Management") shows the Atlas knows.

**Ep7. Insurance & defense** [T3] — Resilience Fund `ccd36a29` /A.2.9.1.1.1
(technical committee, application→approval→payout from Surplus Buffer);
distinct from treasury (allocation) and grants (capacity-building transfers —
Ecosystem Entity Grants /A.2.13 with recorded Aug-2025 disbursements + tx
hashes). Grant vs Reward distinction: one-time capacity transfers vs per-user
incentive flows.

**Ep8. Peg & bridge machinery** [T2] — Lite PSM [T2 ✓ 2026-07-27]: `tin` 0%, `tout`
0%, `buf` 800,000,000 **DAI** (verbatim at `8694e11a` /A.3.3.2.7.1.1.2 Parameter
Values — the unit is DAI, not USDS); "Control of the Lite PSM is being
transitioned to Grove" (`39473e1a` /A.3.3.2.7.1.1 — an earlier version said
"per Accord terms", but the Grove accord subtree A.2.8.2.10 does not mention the
PSM; the transition is stated in the ALM article itself). SkyLink bridges per
chain with rate limits: Solana 5,000,000 USDS/day, "gradually increased over
time as the bridge becomes more mature" ([T2 ✓ 2026-07-27] verbatim at
`8414b48b` /A.4.2.2.2.3.2.2). **Correction (2026-07-27)**: an earlier version
claimed Avalanche/Plasma were "initially unlimited" — the current source says
otherwise: Avalanche's USDS rate limit is **0 USDS per day** (`6d550b28`
/A.4.2.2.3.3.2.2) and Plasma's is **5,000,000 USDS per day** (`527a2195`
/A.4.2.2.4.3.2.2); both are Core-Facilitator-modifiable via the Operational
Weekly Cycle without a prior Governance Poll. Plus Freezer multisigs (F2);
Token SkyLink primitive for pioneer launches.

**Ep9. Risk model framework** [T2] — A.3.2's quantitative core (54 math docs, E3):
implemented models (Lending Markets, Legal Recourse Assets) vs **Pending Risk
Models** (explicit backlog /A.3.2.1.1.4.3.2). Formula chain **corrected
2026-07-27**: an earlier version gave "PD→LGD→EAD→RWA→required capital", which
conflated two models — the Lending Markets chain (A.3.2.2.1.1.1.1.1 steps 1–5)
is actually PD → LGD → Asset Correlation Coefficient R → Capital Requirement
Without Buffers K → Instance Financial RRC, with EAD entering only at the final
step (`fc471b5a`: $\text{RRC} = K \times \frac{1}{CR} \times \text{EAD} \times
\text{ECR}$; LGD itself is `c9bd4928`: $LGD = min(1 - \frac{(1 - LP) * (1 -
S)}{LT}, 0)$), while Aggregate RWA belongs to the separate Real World Assets
RRC process (A.3.2.2.1.1.1.5.2, leverage-adjusted then × 8% capital ratio).
Smart Contract Risk Rating [T2 ✓ 2026-07-27] verbatim at `00fd9362`
/A.3.2.2.1.2.2: $\text{SCRR} = min[\text{CAP}, (\text{SR} + \text{CCR}) \times
\text{LAF} \times {AF}]$, with CAP currently `30` (`b824c6ec`) and the Lindy
Adjustment Factor (log-age discount, [T2 ✓ 2026-07-27] at `227eff62`
/A.3.2.2.1.2.2.4: $\text{LAF} = max(0, 1 - \frac{ln(1 + \lambda \times
\text{AGEeff})}{ln(1 + \lambda \times \text{max})})$) — the Atlas quantifies
contract maturity trust.

### F. Relational/social concepts (the entity layer)

*[T1] — entity/edge/role counts are script-censused.*

**F1. Actor role system**

- **Definition** — who may act in what capacity.

- **Detection signature** — entity types (11 agents, 3 facilitator_orgs, 2 govops_orgs, 13 delegate_orgs, 9 foundations, 6 dev companies, 10 composite parties, ~60 ecosystem actors incl. 7 bridge validators, 3 src_members) + role edges (prime_agent_for, *_facilitator_for, *_govops_for, aligned/ranked_delegate_for, erg_member_for, authorized_rep_for, holds_role_for, validator_of).

- **Relationships** — rulebooks for each role live in A.1 (actor rulebook chunks); operational assignments live in artifacts.

**F2. Multisig governance**

- **Definition** — the signer network.

- **Detection signature** — 31 multisig entities; edges signer_of (56), can_modify_signers_of (27); titles "Signers" (×21), "Required Number Of Signers" (×20), "Modification" (×25); registry `A.2.11.1.3.4.2 List Of Registered Multisigs`. Named family: SkyLink Freezer Multisigs per chain (Ethereum/ Solana/Avalanche/Plasma — each with a doc in A.1 AND A.4: cross-scope duplication). **Relayer Role** (×33 docs + 125 mentions): ALM multisig role within allocation instances, chain-suffixed (Mainnet/Base/Arbitrum…).

**F3. Funds-flow concepts**

- **Definition** — who pays whom.

- **Detection signature** — funds_transfer (23), funds_authorization (5), funds_data_gap (1) edges; payment-list registries (H1).

- **Relationships** — agents' economic-flows findings merge here.

### G. Duties & responsibilities

*[T1] — duty_for/RP-edge counts are script-censused (see the accuracy correction on the relations.json point below).*

**G1. Duty assignments**

- **Definition** — obligations extracted per party.

- **Detection signature** — `duty_for` edges (build-graph §2s-ter) — 854 in the graph, and they DO ship in `relations.json` (an earlier version of this entry claimed otherwise — corrected), plus process_step_responsible_party_for (32), responsible_party_for (63/64).

- **Relationships** — RedLens reports (Op Facilitator / GovOps Responsibilities, OEA Assessment) are validated curations of this concept.

**G2. Active Data stewardship**

- **Definition** — mutable operational values with a designated controller.

- **Detection signature** — `type: Active Data` (76) + `Active Data Controller` (64) + active_data_for edges (76); structural suffix `.0.6.X`.

- **Spread** — **artifacts hold the majority (54 AD + 42 ADC)**; A.2 (13+13), A.1 (7+7), A.3 (2+2).

- **Relationships** — every registry (H1) with live content is an Active Data doc; Updating Active Data procedure at `75e8fd51` /A.1.13.

### H. Registry concepts

*[T1] — the registry list and liveness split are script-censused (`:::census registry-liveness` below).*

**H1. Registries ("List Of …")**

- **Definition** — enumerable live collections the Atlas maintains.

- **Detection signature** — title prefix "List Of" (46 docs) + listed_in edges (47) + `.0.6.X` Active Data suffix on the live variants. Sub-families: - Party registries: Recognized Aligned Delegates, Derecognized Alignment Conservers (11 listed_in), AD Breach Registry, Authorized Forum Accounts (15), Active Arrangers, Registered Multisigs, SRC Membership Registry. - Program registries: Current/Onboarding Integrators, Integrator Applications, Distribution Reward Payments (×17 lists!), Integration Boost Payments (×9), Allocation Instances, Sky Direct Exposures, Auxiliary Accounts. - Governance registries: Interpretations, Registered Spell Checklists, Document Types, Top/Mid-Tier Audit Firms.

- **Relationships** — registries are where concepts MATERIALIZE as data — the payment lists are the terminal nodes of the Distribution Rewards concept chain.

**H1-liveness** — no descendants, no data table, and no bulleted entries marks
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

### I. Cross-link hubs (most-cited docs — the concept anchors)

*[T1] — cite counts are script-censused (graph `cites` edges).*

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
| Definitions (A2) | ●56 | 16 | – | 9 | – | – | – | – |
| Type system (A1) | – | ●30 | – | – | – | – | – | – |
| Annotations (A5) | 2 | ●47 | 10 | 8 | – | – | 1 | – |
| Action Tenets (A6) | 2 | ●28 | – | – | – | – | – | – |
| Scenarios (A7) | – | ●9 | – | – | – | – | – | – |
| Primitive specs (B1) | – | – | ●15 | – | – | – | ×8 copies | – |
| ICDs/instances (B4) | – | – | few | – | – | – | ●196 | – |
| Process defs (C1/C2) | – | – | schema | – | – | – | ●96 | – |
| Cycles (C4) | – | ●2 | 1 | – | – | – | – | – |
| Emergency (C5) | – | ●hub | – | – | – | – | protocols | – |
| Parameters (E1/E2) | – | – | – | ●core | 3 | – | ●per-ICD | – |
| Formulas (E3) | – | ~5 | 2 | ●54 | 3 | – | – | – |
| Addresses (E4) | – | some | some | – | ●SkyLink | – | ●bulk | – |
| Active Data (G2) | – | 7 | 13 | 2 | – | – | ●54 | – |
| Registries (H1) | – | ●gov | ●program | 2 | – | – | ●payments | – |
| Needed Research (A4) | – | – | – | – | – | – | – | ●12 |

(● = concentration site. The Accessibility Scope A.5 hosts essentially no
cross-cutting machinery — pure prose.)

### II.2 By detection signature type

- **Doc type**: A1, A2 (via extraction), A4, A5, A6, A7, G2.
- **Title template**: B2, B3, B4 (partly), B6, C1, C2, E1, E2, E5, H1, StarGuard,
  Transitionary Measures, Relayer Role.
- **Edge type**: B4/B5 (instance_of/invoked_by), C5 (emergency_response), F1 (role
  edges), F2 (signer edges), F3 (funds edges), G1 (duty_for, in relations.json), G2
  (active_data_for), H1 (listed_in), accords (ecosystem_accord).
- **Content pattern**: E3 (math), D0 prohibitions, C6 numbered steps, dated
  commitments (61 docs).
- **Curated**: C3 (processes.json), glossary.json, report modules (riskRules,
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

The 132 curated processes (C3) map onto this catalog cleanly — evidence the
concept taxonomy and the human-validated process taxonomy agree:

| processes.json category (n) | Concept groups |
|---|---|
| Settlement & Financial (45) | C4 settlement cycle · F3 funds flows · E-money mechanisms (agent report pending) |
| Dispute & Emergency (20) | C5 emergency · D8 dispute resolution · Dn5 escalation |
| Agent & Primitive Lifecycle (16) | B1–B6 lifecycle · D9 termination · D11 incubation |
| Collateral & Asset Management (16) | E2 rate limits · allocation systems · RWA/arrangers |
| Personnel & Delegation (13) | D6 delegation · F1 roles · Dn3/Dn4 suspension/derecognition |
| Executive & Spell Processes (12) | D5 spell machinery |
| Governance & Voting Cycles (5) | C4 cycles · D4 voting |
| Artifact & Atlas Governance (5) | D3 edit-instrument triad |

### II.6 Cross-scope concept duplication (same concept, parallel docs)

*[T1] — the census below (mechanical set-diff).*

*[T2] — the curated exemplars, hand-picked and read from the census output.*

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

### II.7 Master index (A–Z, → group)

Accords (Ecosystem) →D1 · Accords (Executor) →D2 · Action Tenets →A6 · Active
Data →G2 · Adjudication →Dn7 · Agent Artifacts →B (II.4) · Agent Termination
→D9 · Agent Tokens →Ep1/A.4.5 · Aligned Delegates →D6 · Alignment/Eligibility
→Dn8 · Allocation Systems →Ep2 · ALM & Rental →Ep2 · Annotations →A5 · Artifact
Edit Proposals (per-instance) →D3/B6 · Atlas Edit Proposals →D3 · Budgets →Ep6 ·
Bridges/SkyLink →Ep8 · Compensation formulas →E3/Ep3 · Conduct standards →Dn6 ·
Core Governance Reward →Ep1 · Cycles (weekly/monthly/settlement) →C4/Ep4 · Data
Repositories →B6 · Definitions →A2 · Delegation →D6 · Derecognition →Dn4 ·
Dispute Resolution →D8 · Distribution Rewards →Ep1 · Duties →Dn1/G1 · Emergency
machinery →C5/D5 · Executor Agents →F1 (ghost layer) · Fees (Upkeep) →Ep5 ·
Formulas →E3 · Foundations →F1 · Glossary →A2 · Governance votes →D4 · Grants
→Ep7 · Hubs (primitive) →B2 · ICDs/Instances →B4 · Incubation →D11 · Integration
Boost →Ep1 · Integrator Program →Ep1/H1 · Interpretations →A3 · Invocations →B5 ·
Multisigs →F2 · Needed Research →A4 · Omni Documents →B7 · Parameters →E1 ·
Payment lists →H1 (empty) · Peg Stability Module →Ep8 · Pending transitions →D12 ·
Pioneer Chain →Ep1 · Policies/Rules →Dn1–Dn9 · Primitives →B1 · Procedures →C1–C3 ·
Prohibitions →Dn2 · Protocols (routine/emergency) →C2 · Rate Limits →E2 · Rates
(SSR/DSR/stUSDS) →Ep3 · Registries →H1 · Relayer Role →F2 · Resilience Fund →Ep7 ·
Risk models →Ep9/E3 · Root Edits →D3 · RRC coverage →E5 · Scenarios →A7 · Smart
Burn Engine →Ep4 · Spells/StarGuard →D5 · Staking →Ep3/Ep4 · Suspension →Dn3 ·
Transitionary measures →D10 · Treasury waterfall →Ep4 · Type Specifications →A1 ·
Usage Standards →Dn6.

## Part III — Distinctions & open questions

**Distinctions refined so far** (agents extend):
- *Registry vs Active Data*: registries are the CONCEPT (an enumerable collection);
  Active Data is the MECHANISM (mutable doc + controller). Live registries are AD;
  some AD is not a registry (single values like Tau Current Value).
- *Procedure vs Protocol vs Cycle*: procedure = step sequence (C1/C3); protocol =
  severity-tier variant of a procedure (C2); cycle = calendar scheduler that invokes
  procedures (C4).
- *Parameter vs Formula*: parameters are tunable inputs (E1/E2, mostly per-ICD);
  formulas are relationships over them (E3, concentrated in A.3.2). The Stability
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
- "Voting" as a standalone family: dissolves into cycles (C4) + instruments (D4/
  D5) + duties; no coherent separate group.
- "Automated vs manual execution": a classification flag, not a concept — the
  normative question is who decides, which is a duty (Dn1).
- Reward *normative* logic as separate family: distributes into duties, rate
  limits, scenarios — inseparable.

**Spec'd-but-unrealized concepts** (the "ghost layer" — strongest staleness set):
1. Budget Controller/Directory/Document doc types: unused (budgets run as Core
   docs, Ep6).
2. Translation, Archive, Original Context Data, Facilitator Action Precedent,
   Navigation/Focus Hub types: no instances found.
3. All 26 reward payment registries: empty shells (H1 census).
4. Three 0-USDS budgets (Ep6).
5. Pending Risk Models backlog (Ep9), Agent Token staking rewards (mentioned,
   unspecified), Purpose System funding (article exists, machinery thin).
6. Executor Agents overall: "not yet operational" per definition — 10-doc
   artifacts vs primes' hundreds.

**Open questions for the next pass**:
- ~~The 854 duty_for edges live only in the DB graph~~ RESOLVED: they ship in
  `relations.json` (build-graph §2s-ter) — an earlier version of this entry
  and two others in this doc (G1, II.2) claimed otherwise; all three corrected.
- Do the spec'd-but-unused doc types (Budget…, Translation, Archive) appear in atlas
  HISTORY (existed once) or were they never populated? (atlas_history query.)
- Payment lists (17+9) per reward instance: extractable into a Payments dataset
  (amounts/dates) for the flows index?
- ~~"Near-Term Process" (19 cites)~~ RESOLVED: it's the interim Distribution Reward
  payment rule (Operational GovOps calculates; paid from Demand Side Buffer within
  7 days of month-end) — a D10-family transitional doc that 19 instance protocols
  cite. Its "near term" phrasing is undated → stale-date candidate.
- Map C3's 8 curated categories onto the concept catalog as a validation pass.

<!-- AGENT FINDINGS PENDING: normative layer · programs/economic flows · accords/instruments -->
