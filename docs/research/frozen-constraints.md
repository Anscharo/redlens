# The Frozen Foundation: Constraints Encoded in the Atlas's Never-Modified Docs

*Research report, 2026-08-06. Companion report: [synlang-wiki.md](synlang-wiki.md) (formal encoding of this corpus for the chatbot). Data: live DB at atlas commit `441313ab`, measured 2026-08-05.*

## Thesis and headline result

Hypothesis: the atlas docs that have **never been semantically modified** and are **older than 5 months** form an "immutable or glacially slow-moving foundation" that encodes the ecosystem's implicit and explicit constraints.

The hypothesis holds, with one essential refinement: **the frozen cohort is half the atlas (5,593 of 11,149 docs, ~766KB), and it splits into two very different populations**:

- **Frozen-because-settled** (~85% of the substantive text): the constitutional core — the amendment formulas, the deontic rulebook, the risk-parameter tables, the role lattice, the type system. This is where nearly all of the atlas's hard constraints live.
- **Frozen-because-abandoned** (~15%, but a large share of the *doc count*): scaffolding that was built and never filled — empty registries, "will be specified in a future iteration" placeholders, `Inactive` activation switches, empty emergency-protocol containers.

Both halves encode constraints — the abandoned half encodes them *by shape* (what the atlas has committed to specify) rather than by content.

| metric | count |
|---|---|
| total atlas docs | 11,149 |
| zero semantic modifications ever | 7,287 |
| **frozen cohort (zero mods AND first seen ≤ 2026-03-05)** | **5,593** |
| cohort text mass | ~766KB (~190K tokens) |

By scope: A.6 (Agent Artifacts) 4,148 docs / 465K chars; A.1 (Governance) 382 / 123K; A.2 (Support) 567 / 78K; A.3 (Stability) 332 / 68K; A.4 (Operational Efficiency) 108 / 19K; A.0 36; A.5 17; NR-x 3. By type: Core 5,347, Type Specification 24, Section 80, Annotation 45, Article 35, Action Tenet 10, Active Data 38, Scope 7, others small.

Method: three extraction agents each read one scope-slice of the full cohort dump; findings were tagged settled/abandoned using the project's concepts censuses; 12 citations were re-verified verbatim against the live atlas (all passed). Cohort definition and SQL in the appendix.

## 1. The explicit constraint layer

### 1.1 Constitutional hierarchy (the master constraint)

Everything else nests under one settled invariant: **Sky Core (A.1–A.5, Immutable, ≤3 layers deep) is supreme; the Agent Scope (A.6) is subordinate law.**

- "Sky Core retains ultimate 'root-level' authority over Agents via Executive Vote" `{37c79482-b6b3-4055-82ce-169d1da98022}` (A.1.14.1.6); Agents "may not take any governance action … that would have the effect of undermining root control" `{a6996fe3-6018-4241-aae9-bca7eb0fefb5}`.
- Mirrored downward in every agent artifact: "The Spark Artifact cannot be edited in any way that violates the Sky Core Atlas … The Operational Facilitator must enforce this rule" `{535cd1c9-1d4d-42e3-bb44-6c128690dd2d}` (A.6.1.1.1.2.2.2.2.1.2.1.6, template-duplicated across agents). *(verified verbatim)*
- On-chain the same shape: every Liquidity Layer's `DEFAULT_ADMIN_ROLE` "is fully controlled by Sky Governance via the [Agent] Proxy" `{26cac5a1-6313-4aff-952c-70eb84513815}` — agents operate, Sky owns root. *(verified verbatim)*

### 1.2 Amendment formulas (who may change what, at what price)

The frozen layer fixes the complete "constitutional physics" of change:

- **Agent Root Edit pipeline** (template-identical across all 8 Prime Agents): ≥1% of circulating token supply to propose `{fd43ac8d-5461-46e6-8902-4526ef677e3a}` → Operational Facilitator 7-day alignment review `{d21854da-165b-455d-893c-147db514d31c}` → 3-day Snapshot poll, ≥10% participation quorum, 50% in favor `{0c0209b7-fe8c-4d94-8daa-00057bb135cf}` *(verified verbatim)*. Spark adds a parallel 7-day Spark Risk Council review where silence advances the proposal `{f55b35ba-1013-4a86-a874-feda7d750e45}`.
- **Sky Core weekly cycle**: Prime submits Atlas Edit drafts by Monday 23:59 UTC `{461272f0-e9ae-43df-9571-4be49a2286c7}`, Core GovOps formats and submits the following Monday `{07d1ed44-c457-49b9-a054-50e26aa70acc}`, SKY holders decide by Thursday `{afeaa98f-b8f5-48d9-adb2-8ceed287667d}`. Weekly Cycle minimum participation: 480M SKY equivalents `{863b3e56-76c5-4448-b2b0-3b5e2d26a3fa}`.
- **Monthly cycle constraints**: final AEP text frozen 7 days before formal submission `{b9da67b6-4cc2-4bd9-b6ec-900cd855fa64}`; a blocked AEP cannot be resubmitted unamended `{523bfc8f-2d8a-4364-8307-7f9a7a764fd6}`; AEPs cannot contain language blocking other AEPs in the same cycle `{530fe959-2d16-4475-84ba-09a8ba3f66bb}`; **no Monthly Governance Cycle in December** `{6c0810e2-390d-4efb-8b31-f36a7f6e1a05}` *(verified verbatim)*.
- **Entrenchment clauses**: token emissions beyond Genesis Supply "permanently disabled … cannot be reverted by Spark Governance" with a single Sky-held override under Risk Capital violation `{6ff424a3-cb63-4eba-9966-771179ffa3ce}` *(verified verbatim)*; removing a Nested Contributor requires dual SKY+SPK votes for three years after 2025-06-04 `{cc60f445-1ed9-479e-9b44-00de9884a7b5}` *(verified verbatim)*; the Upkeep Rebate Primitive "is not possible to deactivate" — the only primitive with no off switch, even by token vote `{85121142-aa54-4957-b0e1-8f4294512c7e}` *(verified verbatim)*.

### 1.3 Separation-of-powers prohibitions

- **Spell review isolation, triply enforced**: reviewers are prohibited from directly committing code `{952d9bdc-1298-49b5-a52f-11ab480a82b7}` *(verified verbatim)*, from contributing indirectly via PRs `{d3a48eb5-278e-4417-aae5-94b4ee7cf4ea}`, and from merging — only the Spell Crafter may merge `{83f1374d-aa42-4f1d-bea2-5326b578a2af}`; post-deployment suggestions are also banned `{357b6485-46fd-442a-ad6e-8ddff5ca4f7f}`.
- **Alignment Conservers** (Facilitators + Aligned Delegates): one AC role at a time, no simultaneous ecosystem roles `{9b1d1c2f-ace0-4637-8050-4711ae9f9a8c}`; anonymity + high operational security mandatory, breach = derecognition `{36b68ff0-30a3-4fb9-af04-a2869a4233fe}`, `{014feb92-49dc-4117-911f-a6ec14451b30}`; collusion "strictly prohibited" `{403a05ce-f8e0-4ecf-8a56-026c0acd0d8a}`; no kickbacks from delegate compensation to delegators `{45e794a0-5092-4dea-a0de-6f373228f760}`; Facilitators generally barred from counterparty engagement `{3f056c21-92de-4177-8c81-f8ba83a880ca}`.
- **Multisig anti-collusion floor**: Critical Actions need ≥3 signers and "It must not be possible for quorum to be met with signers from a single entity" `{4c8b20c3-e723-4304-904f-7d7f8de5fc8b}`; signer-set changes may never drop below 2 signers with majority execution `{8e1357dc-80a7-4716-becf-9a50ef7ae3a0}`.

### 1.4 The numeric constitution

The frozen layer is dense with exact numbers — the most machine-checkable content in the atlas. Representative set (each a single settled doc):

| domain | parameter | value | source |
|---|---|---|---|
| Risk capital | Capital Ratio | 8.75% | `{4a1d377d-eb0e-481a-a447-9ff3630b8787}` *(verified)* |
| Risk tiers | Smart Contract Risk Rating bands | ≤25 / ≤50 / ≤75 / >75 | `{80701bc2…}` `{8500fc58…}` `{5dc03a3c…}` `{8c73b3c0…}` |
| Breach penalties | Low severity, escalating | 500% → 1,000% → 1,500% APY (30-min steps) | `{32750a35…}` `{4f7e6e09…}` `{9da86bfb…}` |
| Breach penalties | High severity, escalating | 1,500% → 2,000% → 2,500% → 3,000% APY | `{b9bfd816…}` `{7d3dc8ba…}` `{8151947c…}` `{7f70143b…}` |
| Exposure caps | Superstate aggregate / Kamino / Drift | 500M / 25M / 25M USDS | `{ea606bf7…}` `{836668a9…}` `{05036471…}` |
| Safe Harbor | bounty % / cap / retainable | 10% / $10M / false | `{226543b7…}` `{062e64d7…}` *(verified)* `{6ca0bed7…}` |
| Resilience Fund | budget / claim review / quorum | 5M USDS/yr / 5 working days / 3 experts, >50% | `{aa1e93e5…}` `{313d72e5…}` `{10662753…}` |
| Delegates | L2/L3 ranked budgets | 175,000 / 48,000 USDS/yr | `{04b54378…}` `{c51b75e1…}` |
| OCL lending | Initial/Maintenance/Liquidation LTV, cure | 70% / 85% / 90%, 24h | `{f6d82898…}` `{aedd10ee…}` |
| Rate limits | e.g. Keel USDS mint | 10,000 USDS max, 10,000/day slope | `{568f6fae…}` *(verified)* |
| Spell lifecycle | expiration window | 30 days post-deployment | `{d87a286e…}` |
| Agent spec drift | artifact update deadline | 30 days after spec change | `{8dbacc54…}` |

The A.6 slice alone carries ~103 rate-limit docs — every cross-protocol value flow declares a `(maxAmount, slope)` pair, and **unboundedness must be declared, never implied** (37 explicit `Unlimited`, 14 explicit `N/A`).

### 1.5 Temporal and process machinery

- The 13-step Executive Process (A.1.10.2.4, `{98298ab3-8d08-4c4f-b47b-81242a3e3903}`) is the only path for protocol changes: GovOps meeting Tue W1 → Executive Sheet confirmation Fri W1 EOD UTC → Executive Document merged by Tue W2 16:00 UTC with 2 approvals → Spell review Tue W2 → validation window → execution.
- Lifecycle state machine: a primitive instance "must always have exactly one" status value `{d3908a6c-a5b4-40d3-a982-89ad606a24d9}` *(verified verbatim)*; transitions are expressed as subtree relocations (successful invocations move to Active Instances; failed ones archive) — **document position is the state encoding**.
- Founder access is revoked after the Transformation Primitive; founders may then only invoke primitives in a fixed order until setup completes `{20f4cfe0-1855-4942-ac0d-f5cb738e82fc}`; post-Root-Edit, any activation change requires token vote + Operational Executor Facilitator review `{857b85e5-b57e-4043-82eb-6fbb68cf1d51}`.

## 2. The implicit constraint layer

### 2.1 The 8×15 primitive template (the biggest single finding)

A.6's 4,148 frozen docs are essentially **one schema instantiated eight times**. Every Prime Agent artifact is a vector over 15 primitive types at *fixed doc_no slots* (`.2.1.1` Agent Creation … `.2.7.1` Core Governance Reward), confirmed independently by the MCP entity census's exact 8-per-subtype grid. The schema itself is the constraint system:

- Every instance must structurally carry an audit trail (Initial Planning + Operational GovOps Review + Artifact Edit Proposal repositories — present in every instance).
- Every value flow must carry a declared rate limit (see §1.4).
- Every primitive has a pre-built kill/pause topology (Suspended/Failed buckets exist before any suspension ever happened).
- Customization is allowed but fenced: "[a]ny extensions must remain fully aligned with the requirements specified in the Sky Core Atlas … [No customization presently.]" `{917307b6-ec3f-4b5f-b517-3f561c2cfe9a}` — an open extension point no agent has used.
- The template layer is separable from the identity layer: subtree A.6.1.1.7's 196 frozen docs never name their agent at all — agents are late-bound parameters of a constitutional template.

~2,494 of the 4,148 docs (60%) are pure template boilerplate; a schema + per-agent parameter table represents them losslessly. This matters directly for the encoding question in the companion report.

### 2.2 The type system as constraint

The frozen Type Specifications (24 docs, avg 1,130 chars — the densest constraint text per byte in the atlas) bind **authority to nesting depth**: Immutable docs ≤3 layers `{a324e17e-56c9-4d35-b4fa-75593d852f15}`, Primary docs ≥4 layers with no zeros `{7de56365-7762-4bba-b982-04c9ec6582e0}`, Supporting Roots mandatory on all Immutable/Primary docs `{c68d22b2-adf7-4889-9547-ec19e850a1b2}`, six fixed Scopes `{69dc9b57-ad4d-4d84-9775-cc5338c43820}`, archives immutable once created `{65c724f5-56d7-4ea6-a0fe-de30e6f04560}`, English canonical over translations `{dde9bb23-9ba2-4de6-a3fe-3093e5108fa4}`, single-source-of-truth for definitions `{6eceace8-f499-4954-9ecc-1ada12a02c18}`, and the Sky-Atlas-version-prevails rule for artifact discrepancies (A.1.14.2.3.1).

### 2.3 Epistemic meta-constraints

A distinctive frozen layer constrains *how decisions may be made*: Chesterton's Fence — "Changes must not be made unless reasoning behind current state understood" `{e5a96bad-0b8d-4cac-afda-d1bd41d6bcb0}`; the Tenth Man Mandate — unanimous decisions must be red-teamed `{5a4e1225-6151-4eb0-ae6b-5644f15b1b12}`; the Lindy heuristic `{aa0a8049-f883-4366-9924-6651aeec14e6}`; the Extrapolation Principle bounding Facilitator discretion to the Spirit of the Atlas `{453cd0ba-534c-45b3-8cb2-0154e579c3cd}`. A.0's definitions (Universal Alignment `{9f953b73-566e-4428-a9d2-e179513c3371}`, Incentive Slack `{133c6032-0082-4644-a3d5-87bcf5b30249}`, Endgame State `{8a57b601-aec4-49dc-bf34-383c63da11de}`) frame governance as intent-alignment rather than rule-compliance — a deliberate license for bounded discretion.

### 2.4 Code-as-law embedding

~80 A.6 docs quote Solidity/Rust verbatim as normative text (`onlyRole(RELAYER)` gates, `RateLimits` require-strings, Solana permission structs). The atlas thereby encodes an implicit **text↔bytecode sync constraint**: the frozen artifact text *is* the specification the deployed contracts must match.

## 3. The frozen-because-abandoned ledger (absence as constraint)

Tagged via the registry-liveness, empty-scaffolding, and concepts censuses rather than rediscovered:

- **30 empty "List Of …" registries corpus-wide, 26 of them frozen payment registries in A.6** (Distribution Reward / Integration Boost payment lists with a lead-in sentence and zero rows). The A.2 integration layer is likewise dead: no integrator applications `{30db9618…}`, no current integrators `{efbe7903…}`, no approved legal counsels `{e1f72c98…}`, no active policyholders `{6db0f9ee…}`, no active resilience research projects `{dd379ac9…}`. The recording obligations exist; the records don't.
- **~37 (A.6) + ~10 (A.2/A.3) "will be specified in a future iteration" placeholders** — deferred design slots, not ambiguities: emergency response protocols, SRC election procedures, frontend security/information standards, Perpetual Positions / Direct Exposures / Bond-Like Instruments / Cash Stablecoins risk models, Capital Injection and Creation Fee amounts, the Core Council Executor Agent 1 artifact.
- **52 of 132 frozen Global Activation Status switches are `Inactive`** — fully scaffolded primitives never turned on (vs 64 Active, 16 Completed).
- **63 vs 23 `Pending`:`Covered` RRC-implementation flags** — most frozen instances run on not-yet-fully-implemented risk models.
- **18 of 21 "Short-Term Transitionary Measures" are frozen 5+ months** — the "until Powerhouse supports X" Forum/GitHub workarounds are the de facto governance rails.
- **Ecosystem Accords 3–7 are indefinite-duration with substantive terms still deferred** — permanent commitments whose content is a placeholder.

Interpretation: the scaffolding constrains by shape. A named-but-empty Emergency Protocol container commits the atlas to *having* one and to *where it will live*; an empty registry encodes the schema every future entry must satisfy (e.g. the payment-record schema `{0b55dd49-4787-4895-be75-091f9c2689f3}`: Reward Period, Payee, Payment Address, Amount Paid, Transaction Hash, Transaction Date).

## 4. Counts

| constraint kind | A.6 slice | A.1/A.3/A.4/NR | A.2/A.0/A.5 |
|---|---|---|---|
| obligations (families) | 14 (+~200 operator-procedure docs) | 11 | 20 |
| prohibitions | 13 | 10 | 6 |
| numeric parameters | ~45 distinct + 103 rate-limit docs | 28 | 23 |
| role/permission | 12 families | 6 | 16 |
| temporal/process | 11 | 12 | 19 |
| definitional | ~30 | 8 | 8 |
| structural invariants | 7 | 7 (+10 Type Specs) | 8 |
| absence-as-constraint | 5 classes | 6 classes | 11 items |

Docs containing deontic keywords in the A.6 slice alone: 202. Settled:abandoned ≈ 85:15 by text mass across all three slices.

## 5. What this means for the reader product

1. **The frozen cohort is the right retrieval target for "what are the rules" questions.** It concentrates the atlas's deontic language, numbers, and role restrictions, and it changes glacially — anything derived from it (indexes, encodings, verifier tables) has near-zero maintenance cost. Staleness detection is already built: the mod-counts predicate that defined the cohort.
2. **Settled vs abandoned tagging is essential for answer quality.** "The atlas has a Lawyer Registry" is true-but-misleading; the frozen layer itself says there are no active counsels. A chatbot that can't distinguish scaffold from substance overclaims — this is the exact failure mode the existing `atlas_entity` tool guidance warns about ("a document existing FOR an entity does not mean the entity has that thing populated").
3. **The 8×15 template means the corpus is far smaller than it looks.** ~60% of the frozen A.6 mass is one reusable schema — the key fact for the encoding assessment in the companion report.

## Appendix: cohort definition and verification

"Modified 0 times" = zero `atlas_history` rows matching the Modification Frequency report's own predicate (`src/server/history/mod-counts.ts`): `change_type='content' AND (change_kind='semantic' OR (change_kind IS NULL AND diff IS NOT NULL))` — renumbers/moves, lint, and typo fixes don't count. "Older than 5 months" = earliest `added` event on or before 2026-03-05, **with undated births (severed-era, pre-git) and no-added-event seam docs counted as old** — null first-seen means oldest, not newest; a naive date filter would drop exactly the most ancient docs.

```sql
WITH h AS (
  SELECT doc_id,
         COUNT(*) FILTER (WHERE change_type='content' AND (change_kind='semantic'
           OR (change_kind IS NULL AND diff IS NOT NULL)))            AS semantic_mods,
         COUNT(*) FILTER (WHERE change_type='added')                  AS added_rows,
         COUNT(*) FILTER (WHERE change_type='added'
           AND committed_at IS NULL)                                  AS undated_births,
         MIN(committed_at) FILTER (WHERE change_type='added')         AS first_added
  FROM atlas_history GROUP BY doc_id
)
SELECT d.* FROM atlas_doc_meta d LEFT JOIN h ON h.doc_id = d.id
WHERE COALESCE(h.semantic_mods,0) = 0
  AND (h.undated_births > 0 OR h.first_added <= '2026-03-05'
       OR COALESCE(h.added_rows,0) = 0);
```

Extraction: three parallel agents over complete scope-slice dumps (A.6; A.1+A.3+A.4+NR; A.2+A.0+A.5), with settled/abandoned tags cross-checked against the concepts censuses (`atlas_describe` sections `censuses`). Verification: 12 citations spanning all three agents re-fetched via `atlas_get` and matched verbatim (marked *(verified)* above). Caveat: the mod-counts predicate under-counts one edge case — a content change with NULL classification and no stored diff (e.g. a title-only rename) is invisible to it, so a handful of cohort members may have had title tweaks.
