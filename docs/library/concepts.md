# Atlas Concept Catalog

The cross-cutting conceptual groupings of the Sky Atlas — the organization that does
NOT follow the tree. Mission + method: `docs/features/atlas-library/CONCEPT-MINING.md`.
Built at atlas `db87434`. Counts are exact when censused (scripted over docs.json /
relations.json / MCP), "≈" when sampled.

Legend per group: **Def** (membership criterion) · **Sig** (detection signature —
mechanically re-findable) · **Members/spread** · **Rel** (nesting/overlap).

---

## Part I — Concept catalog

### A. Meta-concepts (the Atlas describing itself)

**A1. Document Type System** — Def: the Atlas's own vocabulary of 30 document types.
Sig: `type: Type Specification`, all under `f65c083f` /A.1.2.2 (registry doc
`A.1.2.2.2 List Of Document Types And Their Specifications`). Members: 30, all in A.1.
Rel: contains every overlay concept below; **discovery: several spec'd types have no
instances in the corpus** — Budget Controller/Directory/Document, Translation, Archive,
Original Context Data, Facilitator Action Precedent — spec'd-but-unused concepts
(candidate staleness or future machinery).

**A2. Definitions of Terms** — Def: canonical term definitions collected in
Definitions sections. Sig: glossary extraction (direct [Core] children of
`Definitions` sections) → `public/glossary.json`. Members: 81 terms from 3 sites:
A.0 (56), A.1 (16), A.3 (9). Rel: terms are used corpus-wide; definition sites are
NOT where the concepts operate (e.g. "Distribution Reward" defined in A.0, operates
in A.2/A.4/A.6).

**A3. Interpretations** — Def: recorded rulings on the Spirit of the Atlas. Sig:
subtree of `55626fc2` /A.1.1.3 List Of Interpretations (+ its Active Data list).
Rel: registry pattern (H1); normative meta-layer.

**A4. Needed Research** — Def: open questions the Atlas assigns itself. Sig:
`type: Needed Research`, `NR-X` doc_nos. Members: 12. **Discovery: NR numbering has
gaps** (present: 1,2,3,4,5,7,8,9,10,12,17,18 — missing 6,11,13–16): items were
resolved/removed; history could recover them. Rel: two NRs share a title
("Systematic Basis Of Adjudication, Fact-Finding And Evidence" — NR-1, NR-8),
linking to the Adjudication concept (D-group).

**A5. Annotations** — Def: commentary attached to elements. Sig: `type: Annotation`
(structural suffix `.0.3.X`), `annotates` edges (101). Spread: A.1 (47), A.2 (10),
A.3 (8), A.0 (2), artifacts (1) — concentrated on the Governance Scope.

**A6. Action Tenets & Precedents** — Def: behavioral directives for Facilitators.
Sig: `type: Action Tenet` (`.0.4.X`). Members: 30 — only in A.0 (2) + A.1 (28).
Rel: the paired "Facilitator Action Precedent" type is spec'd but unpopulated (A1).

**A7. Scenarios** — Def: worked governance examples w/ variations. Sig: `type:
Scenario`/`Scenario Variation` (`.1.X`, `.varX`). Members: 6+3, all in A.1.

### B. Lifecycle concepts (the primitive machine)

**B1. Primitive** (class) — Def: reusable capability spec with hub/instances/
invocations lifecycle. Sig: entity_type `primitive` (15 subtypes × 8 agents = 120
entities); spec library at `fcde2604` /A.2.2. Rel: contains B2–B6; instantiated
per-agent in artifacts.

**B2. Primitive Hub Document** — Def: per-primitive per-agent status+directory root.
Sig: title template ("Primitive Hub Document" ×136, "Global Activation Status" ×140,
"Hub Data Repository" ×136). Rel: contains B3 directories.

**B3. Instance Directories & Status Buckets** — Def: the Active/Completed/
In-Progress/Suspended/Failed/Archived containers. Sig: title templates (×130–144
each). Rel: the empty ones are the validated staleness signal (8–12 of 17
active-instance dirs per prime are empty scaffolding).

**B4. Instance Configuration Document (ICD)** — Def: THE operational subchunk — an
instance's parameters + process + data. Sig: title "Single Instance Configuration
Document" (×48) or named variants ("Amatsu Instance Configuration Document");
`instance_of` edges (196 instances: 114 allocation-system, 13 distribution-reward,
9 integration-boost, 8×8 per-prime singletons, 3 pioneer-chain, 1 core-governance).
Rel: contains Parameters (E1), Operational Process Definition (C1), Data Repository
(B6).

**B5. Invocations** — Def: in-flight runs of an instance. Sig: `invoked_by` (201) /
`invocation_of` (5) edges; "In Progress Invocations" dirs. Members: 5 tracked
invocation entities (4 distribution-reward, 1 integration-boost).

**B6. Data Repository triad** — Def: per-instance record-keeping: Initial Planning →
Operational GovOps Review → Artifact Edit Proposal. Sig: exact title triple (×83
each). **Discovery: 83 "Artifact Edit Proposal" docs are per-instance edit-history
stubs living INSIDE artifacts** — a distributed change-log, distinct from the Root
Edit pipeline (agents' D-group covers the distinction).

### C. Procedural concepts

**C1. Operational Process Definitions** — Def: an instance's step-by-step operating
procedure. Sig: title (×96) + child protocol triple. Spread: all 8 primes (17/11/15/
24/7/7/8/7 across primes 1–8). Rel: contains C2.

**C2. Routine / Non-Routine / Emergency Protocol triple** — Def: the three-tier
response taxonomy every process carries. Sig: exact titles (×60 each). Rel: the
Emergency tier links to the Emergency Response System (C5).

**C3. Curated Process Inventory** — Def: human-validated list of every step-by-step
procedure. Sig: `public/processes.json` (132 processes, 8 categories: Settlement &
Financial 45, Dispute & Emergency 20, Agent & Primitive Lifecycle 16, Collateral &
Asset Mgmt 16, Personnel & Delegation 13, Executive & Spell 12, Governance & Voting
Cycles 5, Artifact & Atlas Governance 5). Rel: the category system is itself a
validated concept taxonomy; members overlap C1/C2 and D-group instruments.

**C4. Governance Cycles** — Def: recurring cadences. Sig: articles `83edd4e1`
/A.1.11 (weekly: operational + atlas-edit tracks), `7f2ba62c` /A.1.12 (monthly +
calendar exceptions), `6f8d5065` /A.2.4 (monthly settlement). Rel: cycles SCHEDULE
instruments (votes, edits, settlements) defined elsewhere — pure cross-linkers.

**C5. Emergency machinery** — Def: detection→signal→response pipeline. Sig:
`emergency_response` edges (16); subtree `1d940c6d` /A.1.9; "Emergency Spells"
`b8266c11` /A.1.10.5; Emergency Protocol tier (C2). Cross-link hub: `A.1.9.1.3.1
Emergency Response Signal Group` (13 cites) + `A.1.9.1.1 Definition Of Emergency
Situations` (10 cites). Spread: A.1 core + every instance's emergency protocol.

**C6. Numbered step procedures (raw)** — Def: docs whose content is a literal
numbered sequence. Sig: content regex (`1.` then `2.` lines) → 44 docs. Rel: subset
feeds C3; exemplars outside processes.json are candidates for its next triage
(e.g. `A.1.6.4.4.1 AD Monthly Compensation Cycle`).

### D. Normative & instrument concepts

**The normative-family taxonomy** (from the normative deep-dive, counts corrected
against local censuses; ⚠ = agent hypothesis not yet verified doc-by-doc):

**Dn1. Duties** — role-subject obligation sentences (must/shall/will + power
verbs), extracted as `duty_for` edges: **854 in the DB graph, all sourced from
A.1** (322-edge sample censused: top duty-holders are Facilitator variants and
Executor Agent GovOps; many duty targets are themselves normative-doc titles —
duties citing duties). Distinctions: obligation (must) vs permission (may) vs
discretionary (at discretion of); title-level vs prose duties; universal
("Facilitators must…") vs qualified ("Core Facilitator must…").

**Dn2. Prohibitions** — negated norms. Censused: 53 docs carry prohibition
language. Exemplars: Kickbacks Prohibited `45e794a0` /A.1.6.5, counterparty
engagement ban /A.1.7.8. Distinctions: blanket vs conditional; permanent vs
status-scoped; self-executing vs adjudicated.

**Dn3. Suspension/deactivation state rules** — reversible capability removal.
Sig: Global Activation Status docs (×140) + has_status edges (136) + suspension
docs per actor type. Distinct from Dn4 (permanent).

**Dn4. Derecognition machinery** — permanent removal: the "Swift Action…" title
family (parallel docs for ACs /A.1.5.8 and ADs /A.1.6.6), AC Derecognition
/A.1.5.10 (+ its live "Derecognized Alignment Conservers" registry, 11 listed_in
edges), facilitator-security derecognition /A.1.7.4, AD Breach Registry (Tier
system: "Tier 2 (Integrity) Breaches" /A.1.6.6.1.2).

**Dn5. Escalation & precedence** — who decides on conflict: Conflict Resolution
/A.1.2.3 (Atlas-doc precedence), Facilitators' authority chain, dispute paths
(D8), "Precedence Over Conflicting Provisions" /A.0.1.2.1.2 (bootstrapping
supremacy).

**Dn6. Conduct standards** — HOW-obligations qualifying duties: "Facilitators
Must Err On Side Of Caution" (A.1.6.9 AND A.1.7.5 — template family), operational
security mandates (A.1.5.7, A.1.6.7, A.1.7.3), Highest Standard/broadest-sense
interpretation rules, Usage Standards (×22 docs, per-instance).

**Dn7. Adjudication & proof** — Adjudication Process `560e1024` /A.1.5.9 (9
cites), Standard of Proof In Universal Alignment Controversies /A.1.5.4 ("doubt
resolved against the AC"), evidence rules; NR-1/NR-8 both titled "Systematic
Basis Of Adjudication, Fact-Finding And Evidence" — the Atlas knows this layer is
underspecified.

**Dn8. Alignment/eligibility framework** — Universal Alignment requirements
(A.1.5.3), one-role-at-a-time rule (A.1.5.5), conflict-of-interest disclosure
(delegate onboarding), misalignment definitions. Rel: triggers Dn4 via Dn7.

**Dn9. Edit restrictions & governance gating** — who may modify what: Artifact
Edit Restrictions (per root-edit pipeline, incl. "Time-Limited Root Edit
Restrictions On Removal Of Nested Contributors"), ADC modification rules (the 64
Active Data Controllers each gate their AD doc), immutability clauses ⚠ (density
unverified). Rel: G2 stewardship is the mechanism; this is the norm.

**Dn-hub note**: normative concepts chain: eligibility (Dn8) → duties (Dn1) +
standards (Dn6) → breach (Dn2 violations) → adjudication (Dn7) → suspension
(Dn3) → derecognition (Dn4), with escalation (Dn5) as the routing layer. This
pipeline IS the Atlas's justice system — nowhere presented as one system in the
tree, fully reconstructable from the concept layer.

**D1. Ecosystem Accords** — Def: bilateral/multi-party agreements between Sky Core
and ecosystem parties, Atlas-recorded and governance-enforceable. Sig: title
"Ecosystem Accord N: X And Y" under `be46648d` /A.2.8.2; `ecosystem_accord` edges
(20). Members (all 10): 1 Grove&Spark `9ca40096`, 2 Prime Program (Spark/Moonbow/
Sky) `aa3b8e65`, 3 Keel `63a88b08`, 4 Obex `6bddc5aa`, 5 Core Council Executor
Agent 1 `3aa58bdc`, 6 Osero `45125ff8`, 7 Skybase `8a74919c`, 8 Amatsu `9d187ae2`,
9 Ozone `cb3c159b`, 10 Grove `0cb00b28` (each: Key Details + Substantive Terms).
Rel: governed by Dispute Resolution (D8); parties are composite_party entities;
Accord 10 carries the Compensation Formula (E3).

**D2. Executor Accords** — Def: Prime↔Executor operational-insurance agreements —
a PRIMITIVE, not a document-accord. Sig: primitive/instance subtype
`executor-accord` (8+8); spec `88017877` /A.2.2.6.1. Rel: mutual-exclusion rule
with Root Edit (both cannot be deactivated — A.2.2.1.2.4.2.1). Distinction vs D1:
D1 binds parties bilaterally; D2 codifies an operational relationship inside the
primitive machine.

**D3. The edit-instrument triad** — three same-sounding but distinct concepts:
- **Root Edit** (governance primitive): agent self-modification via token-holder
  vote; spec `78488c6b` /A.2.2.6.2; 8 instances; pipeline Submission → Expert
  Advisor Review → Facilitator Review → Token Holder Vote → Artifact Update, with
  Routine/Non-Routine/Emergency protocol variants and edit restrictions.
- **Artifact Edit Proposal (per-instance record, ×83)**: data-repo stub inside
  every ICD (B6) — the distributed change-log.
- **Atlas Edit Proposal (AEP, atlas-level)**: amendments to the core Atlas via the
  Atlas Edit Weekly/Monthly Cycle `14e99d92` /A.1.11.2 + `d2cbddd2` /A.1.12.2;
  mandatory template (A.1.12.2.3), Ratification Poll (2 weeks, 240M SKY minimum,
  binary — A.1.12.2.6); blocked AEPs cannot resubmit unchanged.

**D4. Voting machinery** — Def: the consensus layer. Sig: Weekly Poll (A.1.11.1.2.1)
→ Executive Vote (A.1.11.1.2.2) → spell execution; Ratification Polls (D3);
agent-token votes (>1% holding threshold for Root Edit submission);
governance_channel edges (10). Rel: cycles (C4) schedule it; spells (D5) execute it.

**D5. Spell machinery** — Def: executable governance actions. Sig: A.1.10.2
executive process subtree; Emergency Spells `b8266c11` /A.1.10.5 (Standby Spells,
Emergency Drop Spells + Protego authorization); Spell Validators = Aligned
Delegates (validator_of edges, 27); Registered Spell Checklists registry (13
cites); StarGuard per-agent execution contracts (22 docs); Prime Spell Security
Incidents log (Active Data). Rel: emergency tier links C5; misvalidated emergency
votes are AD breaches (→ normative layer).

**D6. Delegation framework** — Def: voting-power intermediation. Sig: aligned/
ranked_delegate_for edges (12/3); registries "List Of Recognized Aligned
Delegates" + per-agent delegate lists (Spark A.6.1.1.1.3.1.3.8); delegate
contracts (one per AD, annotated A.1.6.1.3.1.0.3.1); 6-month terms +
conflict-of-interest disclosure. Notable rule: a Ranked Delegate who triggers a
weekly proposal loses rank immediately (Action Tenet A.1.11.2.1.3.0.4.1).

**D7. Safe Harbor Agreement** — Def: the one ON-CHAIN agreement instrument:
contract `0xf17bB418B4EC251f300Aa3517Cb37349f17697A1` + IPFS-pinned terms; fact
page A.2.11.1.2.6. Distinction: immutable code vs governance-enforceable prose
(D1).

**D8. Dispute Resolution** — Def: formal disagreement service for accords &
terminations. Sig: `f4d827e9` /A.2.8.1 (intake → arguments → decision → recorded
in Active Data "Dispute Resolutions"); conflict-resolution precedence rules
`e883ceb7` /A.1.2.3; termination-dispute path A.1.14.5.4. Precedent count: exactly
1 recorded so far (Grove/Spark facilitator decision, 2025-09-02) — a young system.

**D9. Agent Termination Protocol** — Def: structured agent wind-down. Sig:
`fe833d0e` /A.1.14.5 (initiate via Root Edit vote → Executor executes → forum
notice + residual assets → dispute path). Distinct from emergency suspension
(Sky Core discretionary power, A.1.14.1.5.4).

**D10. Transitional governance family** — three nested layers:
- **Short-Term Transitionary Measures** (~15+ docs, title-pattern census): interim
  workarounds pending permanent systems (forum-post AEP submission until
  Powerhouse; staking rewards pending treasury; Founder Access suspension…).
- **Scope Bootstrapping** `ba97b4dd` /A.1.15: meta-authority to waive normal
  process during Endgame transition (precedence rule A.0.1.2.1.2).
- **Measures For Endgame Transition** `94ed62af` /A.3.7 (incl. the Tau/BEAM
  parameter hub, 18+14 cites).
All three are EXPIRY-implying — prime staleness-signal candidates.

**D11. Incubation frameworks** — Def: onboarding pipelines. Sig: Agent Incubation
`bb0c23c6` /A.2.5, Ecosystem Actor Incubation `b09e86b1` /A.2.6, Integrator
onboarding A.2.2.4.1.3 + Current/Onboarding Integrator registries (H1), module
onboarding checklists A.1.10.2.5.1.1.1.3, delegate onboarding (D6). Rel: feeds F1
actor roles; terminal state = Global Activation (B2).

**D12. Pending transitions** — Def: tracked state-machine progressions. Sig:
pending_transition edges (9, DB graph); Global Activation sequencing
A.2.2.1.2.4.1. Rel: lifecycle II.3 glue; overlaps D10 (expiry tracking).

**D0. Locally-established seeds** (agents refine):
- **Prohibitions** — content signature (prohibit/forbidden/not permitted/may not):
  53 docs. Exemplar: Kickbacks Prohibited `45e794a0` /A.1.6.5.
- **Normative-language mass** — 1,301 docs carry MUST/SHALL/required-to language:
  the rulebook is ~12% of the corpus by doc count.
- **Spell machinery** — StarGuard: per-agent spell-whitelisting/execution contract
  (22 docs, A.1.10.2.3.2.3 subtree + per-artifact "StarGuard Max Delay" ×6 across
  A.1+A.6); Registered Spell Checklists registry (13 cites).
- **Transitionary measures** — "Short-Term Transitionary Measures" title family
  inside artifacts + root-edit pipelines; implies expiry review (staleness signal).

### E. Quantitative concepts

**E1. Parameter Sets** — Def: named tunable values grouped per instance/mechanism.
Sig: title "Parameters" (×210), "Custom Instance Parameters" (×68), "Off-chain
Operational Parameters" (×118), "Instance-specific Operational Parameters" (×20);
Core Stability Parameters `86c75c9c` /A.3.1.2. Spread: overwhelmingly inside ICDs.

**E2. Rate Limit family** — Def: flow-control constraints on allocation systems.
Sig: titles "Rate Limits" (×129), Inflow (×54)/Outflow (×52)/Withdrawal (×43)/
Deposit (×41) + "Rate Limit IDs" (×104), "Inflow/Outflow RateLimitID" (×38 each).
Spread: Spark (59) + Grove (51) dominate; A.4 (3). Rel: nested in ICDs (B4);
normative constraints (D) expressed as numbers (E).

**E3. Formulas** — Def: mathematical definitions (LaTeX/inline math). Sig: content
regex (\frac, \sum, \times, \text{}) → 120 docs; **54 of them concentrate in
`55999acf` /A.3.2 Risk Capital** (probability-of-default model chain: Distance To
Default, Leverage Adjusted Drift To Risk Ratio…), remainder: A.4.4 staking (3),
A.2.8 accord compensation (2, e.g. `A.2.8.2.10.2.1.2 Compensation Formula`), spell
validation math (A.1.10.2). Rel: formulas parameterized by E1 values.

**E4. On-chain object descriptors** — Def: address-bearing docs binding concepts to
chain state. Sig: "Contract Addresses" (×125), "Token Address" (×106), "Underlying
Asset Address" (×101), "Address" (×26); `has_address` edges (261 in relations, 278
in DB); addresses.atlas.json annotation layer. Rel: bridges to the entity layer
(F) and RedLens address artifacts.

**E5. RRC Framework coverage** — Def: per-allocation-instance risk-model coverage
status ("Covered"/"Pending") on the RRC Dashboard (expansion of "RRC" is not
defined in-corpus — candidates: Risk & Regulatory Compliance / Relayer Role
Configuration; flagged as an open question). Sig:
title "RRC Framework Full Implementation" (×61: Spark 53, Grove 8) + "…Coverage"
(×53); interim notice `A.2.2.10.1.1.3.2.1.1.2`. Rel: a STATUS overlay on B4
instances — a validated staleness/coverage signal candidate.

### F. Relational/social concepts (the entity layer)

**F1. Actor role system** — Def: who may act in what capacity. Sig: entity types
(11 agents, 3 facilitator_orgs, 2 govops_orgs, 13 delegate_orgs, 9 foundations,
6 dev companies, 10 composite parties, ~60 ecosystem actors incl. 7 bridge
validators, 3 src_members) + role edges (prime_agent_for, *_facilitator_for,
*_govops_for, aligned/ranked_delegate_for, erg_member_for, authorized_rep_for,
holds_role_for, validator_of). Rel: rulebooks for each role live in A.1 (actor
rulebook chunks); operational assignments live in artifacts.

**F2. Multisig governance** — Def: the signer network. Sig: 31 multisig entities;
edges signer_of (56), can_modify_signers_of (27); titles "Signers" (×21), "Required
Number Of Signers" (×20), "Modification" (×25); registry `A.2.11.1.3.4.2 List Of
Registered Multisigs`. Named family: SkyLink Freezer Multisigs per chain (Ethereum/
Solana/Avalanche/Plasma — each with a doc in A.1 AND A.4: cross-scope duplication).
**Relayer Role** (×33 docs + 125 mentions): ALM multisig role within allocation
instances, chain-suffixed (Mainnet/Base/Arbitrum…).

**F3. Funds-flow concepts** — Def: who pays whom. Sig: funds_transfer (23),
funds_authorization (5), funds_data_gap (1) edges; payment-list registries (H1).
Rel: agents' economic-flows findings merge here.

### G. Duties & responsibilities

**G1. Duty assignments** — Def: obligations extracted per party. Sig: `duty_for`
edges — 854 in the DB graph (NOT present in relations.json; they live in the
server-side graph only — detection note for regenerability), plus
process_step_responsible_party_for (32), responsible_party_for (63/64). Rel: RedLens
reports (Op Facilitator / GovOps Responsibilities, OEA Assessment) are validated
curations of this concept.

**G2. Active Data stewardship** — Def: mutable operational values with a designated
controller. Sig: `type: Active Data` (76) + `Active Data Controller` (64) +
active_data_for edges (76); structural suffix `.0.6.X`. Spread: **artifacts hold
the majority (54 AD + 42 ADC)**; A.2 (13+13), A.1 (7+7), A.3 (2+2). Rel: every
registry (H1) with live content is an Active Data doc; Updating Active Data
procedure at `75e8fd51` /A.1.13.

### H. Registry concepts

**H1. Registries ("List Of …")** — Def: enumerable live collections the Atlas
maintains. Sig: title prefix "List Of" (46 docs) + listed_in edges (47) + `.0.6.X`
Active Data suffix on the live variants. Sub-families:
- Party registries: Recognized Aligned Delegates, Derecognized Alignment Conservers
  (11 listed_in), AD Breach Registry, Authorized Forum Accounts (15), Active
  Arrangers, Registered Multisigs, SRC Membership Registry.
- Program registries: Current/Onboarding Integrators, Integrator Applications,
  Distribution Reward Payments (×17 lists!), Integration Boost Payments (×9),
  Allocation Instances, Sky Direct Exposures, Auxiliary Accounts.
- Governance registries: Interpretations, Registered Spell Checklists, Document
  Types, Top/Mid-Tier Audit Firms.
Rel: registries are where concepts MATERIALIZE as data — the payment lists are the
terminal nodes of the Distribution Rewards concept chain.

**H1-liveness census (2026-07-21): 14 of 46 registries are LIVE, 32 are EMPTY
shells** (no descendants, placeholder content). Empty includes: ALL 17 Distribution
Reward Payment lists, 8 of 9 Integration Boost Payment lists, Integrator
Applications, Current/Onboarding Integrators, Active Arrangers, Top-Tier Audit
Firms (Mid-Tier is populated!). Live: Interpretations, Document Types, Aligned
Delegates, Spell Checklists, Auxiliary Accounts, Sky Direct Exposures, Allocation
Instances, Authorized Forum Accounts, Registered Multisigs, Mid-Tier Audit Firms,
Skybase Core Governance Reward Payments, the two artifact lists.
**Insight: the Atlas's transactional record-keeping layer is largely unrealized —
payments are evidently tracked off-Atlas.** This is the strongest staleness/
emptiness signal found so far, sharper than the empty instance-directory count.

### I. Cross-link hubs (most-cited docs — the concept anchors)

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
  edges), F2 (signer edges), F3 (funds edges), G1 (duty_for — DB-only), G2
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

### II.5 Cross-scope concept duplication (same concept, parallel docs)

- SkyLink Freezer Multisigs: one doc in A.1 (governance view) + one in A.4
  (protocol view) per chain.
- "Swift Action…" misalignment-redress: parallel docs in A.1.5 (ACs) and A.1.6 (ADs).
- Operational/Core Executor Facilitator: defined in A.1.7 sections, mirrored in A.0
  definitions and A.6.1.2 executor artifacts.
- Sky Primitives: A.2.2 (spec) vs "Sky Primitives" title inside every artifact ×8.

---

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

**Dead ends so far**:
- "Tables" as a concept: only 11 markdown tables corpus-wide — table-ness is not a
  useful signature (Atlas encodes lists as doc trees instead).
- Doc `depth` as concept proxy: meaningless past 6 (heading cap).

**Open questions for the next pass**:
- The 854 duty_for edges live only in the DB graph — regenerate the duty concept
  from source or export them into relations.json for offline analysis?
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
