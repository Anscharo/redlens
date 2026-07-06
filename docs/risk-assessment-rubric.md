# Risk Rules Assessment Rubric

Criteria for the client deliverable: a holistic list of every atlas paragraph
that defines a risk-management **rule, parameter, or process**, each critically
assessed for (1) **preciseness** on a 1–5 scale — does it use clear quantifiable
metrics, or is it vague and qualitative — and (2) **enforcement**
`weak | mid | strong` — are penalties or incentives applied for applying the
rule, counting *implicit* incentives that require stepping back to see.

The point of a rubric is discriminating power. If everything scores 3/mid, the
analysis says nothing. Every rating must name the specific evidence — "2,
because the response categories are enumerated but no threshold, deadline, or
metric is given", never "2, seems vague".

## Scope — what counts as a risk rule

Three domains, from the client brief (Sky is a stablecoin protocol; Sky Core
mints USDS; Primes, also called Stars, allocate USDS):

1. **peg** — any rules or efforts that maintain the USDS peg: Core Stability
   Parameters (Base Rate, SSR, stability fees), the Peg Stability Module,
   Actively Stabilizing Collateral, asset-liability rules whose purpose is peg
   defense.
2. **alloc** — managing the risk of USDS allocations: Risk Capital (RRC/TRC,
   junior/senior tiers), exposure and concentration limits, collateral and
   vault risk parameters, liquidation machinery, buffers and backstops, RWA
   counterparty/legal risk.
3. **sc** — smart contract security: audits and security reviews, governance
   security delays and circuit breakers, multisig/admin-key architecture,
   emergency spells and emergency response, spell testing and insurance.

A **rule** is operative text: it constrains behavior, sets a parameter, or
defines a process with steps. Not rules: pure container intros ("This Section
defines…"), definitions that only name a concept without constraining anything,
docs that merely *mention* a risk term while regulating something else
(compensation accounting that references Risk Capital income, marketing text).
Structural stubs ("will be specified in a future iteration") **are** rows — a
promised-but-absent rule is exactly the kind of finding the client wants — and
they score 1 on preciseness.

One row per rule, not per document copy: a clause replicated verbatim across
the per-Prime Agent Artifacts is assessed once, with the covered Primes listed.
Per-Prime *parameter* docs with differing contents stay separate rows.

## Axis 1 — Preciseness (1–5)

How precisely is the rule defined? Judged on the text the regulated party would
be held to: metrics, thresholds, formulas, deadlines, defined actors, and
verifiable conditions.

- **5** — Fully quantified and objectively verifiable. Numeric thresholds,
  formulas, or exact parameter values; a defined actor or controlled system; a
  third party could check compliance from the text alone. ("Prime Agents must
  maintain at least 5% of their Collateral Portfolio in Actively Stabilizing
  Collateral.")
- **4** — Core obligation quantified, minor gaps. The threshold or formula is
  there but a supporting element is not: no measurement cadence, an input
  defined elsewhere without a value, an edge condition left open.
- **3** — Mixed. The rule names concrete parameters, enumerated steps, or a
  named metric, but the operative magnitudes or criteria are qualitative or
  delegated ("as agreed contractually", "subject to review") — you know *what*
  is regulated but not *how much* or *by when*.
- **2** — Qualitative only. A real, identifiable obligation or process exists,
  but it is expressed entirely in judgment language ("monitor", "assess",
  "respond appropriately", enumerated categories with no criteria). Compliance
  is arguable either way on the same facts.
- **1** — Vague, aspirational, or absent. Posture statements, headings with no
  operative text, or explicit stubs ("will be specified in a future
  iteration"). Nothing to comply with yet.

Tie-breaker: if a defender of the regulated party could plausibly argue both
"we complied" and "this doesn't bind us yet" on the same facts, the score is at
most 2.

## Axis 2 — Enforcement (weak | mid | strong)

What consequence attaches to following or breaking this rule? Count **implicit
and structural** enforcement — the benefit is often not stated in the doc:

- **On-chain automatic enforcement is the strongest form.** If contract code
  makes violation impossible or automatically costly (a liquidation penalty, a
  PSM swap at a fixed rate that arbitrages the peg, a debt ceiling the chain
  enforces, a timelock that physically delays attacks), the rule is
  self-executing — rate strong and say the mechanism is on-chain.
- **Capital at risk is a real incentive.** Junior Risk Capital absorbs first
  losses; a Prime that ignores allocation rules loses its own capital first.
- **Named institutional paths count**: penalty mechanisms, conservatorship,
  emergency spells, artifact review, risk-based insurance pricing that makes
  poor security practices expensive.
- **The catch-all alone is always weak**: "misalignment can be reported /
  adjudicated" covers every rule in the atlas, so it says nothing about this
  one. Self-enforcement (the actor policing itself) is also weak.

Levels:

- **strong** — A specific consequence with a defined path that reaches this
  rule's violation modes: on-chain automatic enforcement, or a named enforcer
  distinct from the actor with defined escalation and concrete remedies
  (quantified penalties, conservatorship, removal, insurance repricing).
- **mid** — A general mechanism plausibly reaches the rule (penalty machinery,
  artifact review, emergency response, capital-at-risk) but the consequence is
  unquantified for this rule, or firing requires someone to volunteer the
  escalation.
- **weak** — Only the generic misalignment/adjudication backstop, or nothing,
  or self-enforcement only.

Every mid/strong rating must cite the mechanism doc (UUID) it relies on — from
the catalog below or a UUID appearing verbatim in the document text; a
`mid`/`strong` without a cited mechanism is invalid and becomes weak.

## Enforcement-mechanism catalog

Known enforcement machinery, citable by UUID (doc_nos are editorial labels for
human reference):

- `b8ee2d12-c94b-4d22-b55e-d2b6e6d94ad0` — Penalty Mechanisms (A.3.2.2.7.2):
  quantified financial penalties incentivizing Primes and Operational Agents to
  follow Risk Capital rules.
- `5c3dd35a-0c67-44c2-b51b-d40bc865af85` — Conservatorship For Breach Of
  Capital Requirements (A.3.2.2.7.2.1.4): Core GovOps escalation to expedited
  Executive Vote; Sky Core Facilitator takes direct control of the Prime.
- `12b7d480-68a0-4493-9534-d6915f86c112` — Risk-Capital Incident Response
  (A.2.2.10.1.1.3.2.1.4): defined incident framework; Sky Core may impose
  penalties up to conservatorship to make losses whole.
- `bce9331b-04ca-4c50-9783-098739fc72c8` — Liquidation Penalty
  (A.3.2.2.1.1.1.1.1.2.1): on-chain automatic cost when a position violates
  collateral requirements — contract-enforced.
- `0082c12d-f1a7-46ff-a4aa-5fe42ece1a4d` — Peg Stability Module
  (A.3.3.2.1.1): fixed-rate swaps make peg deviation directly arbitrageable —
  on-chain self-enforcement of the peg itself.
- `3eb6f099-2736-4f62-9cb8-096a8fcca757` — Surplus Buffer and Smart Burn
  Engine (A.3.5): protocol-level loss absorption; economic backstop, not an
  actor-level incentive — alone at most mid.
- `4d8b0d82-97da-4041-b185-4b98c2779cbe` — SKY Backstop (A.3.6): dilutive
  last-resort recapitalization; disciplines governance economically — alone at
  most mid for actor-level rules.
- `b8266c11-3a84-4bbe-abe2-de9474f74ffd` — Emergency Spells (A.1.10.5):
  pre-authorized executive intervention (freezes, pauses) when security rules
  are violated or threatened.
- `1d940c6d-02ce-4c17-8057-cef13c1cc7ad` — Emergency Response System (A.1.9):
  defined escalation protocol outside the standard governance cycle.
- `fd1f682c-2d8a-47c5-8c1d-d95a0a2f2021` — Risk-Based Pricing Of Insurance
  via the Prime Spell Security Registry (A.1.10.2.3.2.2.1.4.2.2): poor
  security practice directly raises a Prime's insurance fees — a priced
  incentive.
- `d4bf73e7-2f9f-454c-8add-614dff784f78` — Agent Artifact Review By Core
  GovOps (A.1.14.2.10): scheduled review with staged findings, published
  outcomes, penalty assessment; enforcer ≠ actor.
- `c6c6f595-b29d-48b1-8196-79d15428e78c` — Reports Of Misalignment
  (A.1.3.2.4). CATCH-ALL: alone this is always weak.
- `560e1024-0897-4f1e-ae71-3ba31e29ed57` — Adjudication Process (A.1.5.9).
  CATCH-ALL: alone this is always weak.

## Calibration examples

Preciseness:

- **5** — A.3.3.2.2 "Minimum Actively Stabilizing Collateral" (`475fe222`):
  "Prime Agents must maintain at least 5% of their Collateral Portfolio in
  Actively Stabilizing Collateral" — named actor, numeric threshold,
  verifiable portfolio share.
- **3** — A.3.2.2.1.1.1.1.1.2.1 "Liquidation Penalty" (`bce9331b`): the
  parameter is named and its role in the debt machinery is clear, but the
  magnitude is "contractually agreed upon" — delegated, not stated.
- **2** — A.2.9.1.5 "Legal And Regulatory Risk Monitoring" (`035ec13b`): a
  real monitoring obligation with enumerated response categories, but no
  threshold, cadence, or metric anywhere — compliance is arguable.
- **1** — A.3.2.1.2.2.1.1.1.1 "Types Of Eligible Assets For IJRC"
  (`a2df2b73`): "will be specified in a future iteration" — a stub.

Enforcement:

- **strong** — Risk Capital requirement rules (A.3.2.2.x): breach triggers the
  Penalty Mechanisms (`b8ee2d12`) and escalates to conservatorship
  (`5c3dd35a`) — named enforcer, defined path, concrete remedy.
- **strong** — vault-level collateral rules: violation is liquidated with an
  on-chain Liquidation Penalty (`bce9331b`) — contract-enforced, no human in
  the loop.
- **mid** — A.3.3.2.2 Minimum ASC (`475fe222`): artifact review (`d4bf73e7`)
  and the penalty machinery (`b8ee2d12`) plausibly reach a violation, but no
  consequence is quantified for this specific rule.
- **weak** — A.2.9.1.5 Legal And Regulatory Risk Monitoring (`035ec13b`):
  no mechanism watches this duty; only the misalignment backstop.

## Process requirements (for the assessment layer)

- **Evidence or it didn't happen**: each row pins the paragraph's full exact
  quote and any mechanism UUIDs the enforcement rating relies on.
- **Drift-safe**: ratings are keyed by doc UUID (or collapsed-title key) + a
  hash of the quoted content. If the atlas changes the text, the rating is
  flagged stale and re-queued — never silently reused.
- **Two-stage**: a cheap triage pass decides in-scope / domain / rule-vs-
  mention and drafts the one-line description; the assessment pass rates only
  triaged-in rules. Both stages are incremental on the same keying.
- **Reasoning format**: 1–3 sentences naming the concrete evidence (the
  threshold, the missing metric, the mechanism and why it reaches or misses).
- Ratings are drafted LLM-assisted against this rubric, then human-reviewed
  before entering the curated artifact; the rubric version is recorded with
  each rating.
