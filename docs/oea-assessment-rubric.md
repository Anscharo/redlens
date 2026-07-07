# OEA Task Assessment Rubric

Criteria for the client deliverable: for every task the Operational Executor
Agent (OEA) performs, rate (1) how precisely the task is defined and (2) whether
it carries proper incentives — each `weak | mid | strong` with reasoning.

The point of a rubric is discriminating power. If every task scores "mid", the
analysis says nothing. Levels below are anchored so that real atlas content
spreads across them, and every rating must name the specific criteria that are
present or missing — "weak, because no deadline and no completion condition",
never "weak, seems vague".

## Scope — what counts as an OEA task

The atlas is explicit that an Executor Agent "acts exclusively through its
associated GovOps and Facilitator actors" (A.1.14.4.6.1). So the task universe
is the union of:

1. **Operational GovOps** duties, assignments, active-data maintenance, and
   process-step responsibilities (the `duty_for` / `responsible_party_for` /
   `process_step_responsible_party_for` graph edges, operational side only);
2. **Operational Facilitator** duties (same edge set once extraction reaches
   parity — see handoff §5/§7);
3. Anything attributed to the **(Operational) Executor Agent directly** as
   acting subject.

Excluded: Core Council GovOps / Core Facilitator tasks (different entity),
Prime Agent tasks that merely *mention* the OEA (recipient/consulted mentions),
definitional docs (they define the role, they don't task it), and rosters
(signer lists, authorized-representative lists — the associated *power* docs
are the tasks).

One row per task, not per document copy: a duty replicated under every agent
artifact (e.g. "Operational GovOps Reviews Rebate" × 8 primes) is assessed once,
with the covered primes listed. A document containing several distinct tasks
gets several rows.

## Axis 1 — Task precision

Six elements of a precisely defined task. Each is either **present** (explicit
in the quoted text or in a directly linked doc), **partial** (implied,
qualitative, or defined elsewhere without a link), or **absent**:

| Element | Present looks like | Absent looks like |
|---|---|---|
| **Actor** | A single named role/org ("Operational GovOps Soter Labs") | "GovOps and relevant stakeholders", actor implied by context |
| **Trigger** | Event or schedule that starts the task ("Upon receiving the draft…", "as part of the Settlement Cycle") | No stated start condition |
| **Action** | Concrete, verifiable verb + object ("remove the Integrator from the list of Current Integrators") | Judgment verbs with no method ("coordinate", "ensure alignment", "oversee") |
| **Time bound** | Deadline or cadence ("within thirty (30) days", "by 23:59 UTC on Monday", "monthly") | "promptly", "regularly", or nothing |
| **Completion condition** | An observable output (a Forum post, an updated Active Data field, an executed payment) | No way to tell the task happened |
| **Bounded discretion** | Where the task is a power ("may impose restrictions"), the conditions and limits of its use are stated | Open-ended discretion ("whatever restrictions it deems necessary", unconditioned) |

**Levels:**

- **strong** — Actor, Trigger, and Action all present, plus at least one of
  Time bound / Completion condition. For powers: conditions AND limits both
  stated. Structured process-step "Update" docs with field-level specs, a
  declared Responsible Party, and a Trigger line are the canonical strong case.
- **mid** — Actor and Action present, but the task floats: no trigger, or no
  time bound *and* no completion condition, or the action relies on a
  qualitative standard that is named but not defined ("reasonably specific",
  "well specified and aligned"). Powers with conditions but no limits (or vice
  versa) land here.
- **weak** — Actor ambiguous, or the action is a posture rather than a task
  ("carries out operational activities on behalf of…"), or the task exists only
  as a title/heading with no operative text, or discretion is unbounded and
  unconditioned.

Tie-breaker: rate the text the OEA would be held to. If a defender of the OEA
could plausibly argue "we did this" and "we didn't have to do this yet" *for the
same facts*, it is not strong.

## Axis 2 — Incentives and penalties

What consequence attaches to doing this task well, late, or not at all?
Elements:

| Element | Present looks like | Absent looks like |
|---|---|---|
| **Existence** | A reward or penalty tied to this task, in the doc or via an explicit link | Nothing, or only the atlas-wide backstop |
| **Specificity** | Quantified or enumerated consequence (formula, amount, removal from role, accord termination) | "may be penalized", consequence unstated |
| **Enforcement path** | A named enforcer, distinct from the actor, with a defined process (review → findings → penalties; adjudication; settlement dispute) | No one is tasked with noticing or acting on failure |
| **Reachability** | The mechanism plausibly fires for *this* task's failure modes | Mechanism exists but its process never examines this task |
| **Positive incentive** | Compensation/budget conditioned on performance | Flat compensation regardless of performance |

**Levels:**

- **strong** — A specific consequence with a defined enforcement path that
  reaches this task, enforced by someone other than the actor. (Positive and
  negative both count; either suffices if specific + enforced.)
- **mid** — A general mechanism applies and would plausibly reach the task —
  e.g. Core GovOps' Agent Artifact review with penalties (A.1.14.2.10), Risk
  Capital penalty machinery (A.3.2.2.7.2), settlement-cycle dispute resolution
  — but the consequence is unquantified for this task, or the enforcement path
  requires someone to volunteer the escalation.
- **weak** — Only the generic misalignment/adjudication backstop, or nothing.
  **The catch-all alone is always weak**: "any misalignment can be adjudicated"
  technically covers every task in the atlas, so it carries no information
  about this one. Self-enforcement ("GovOps must verify GovOps' work") is also
  weak regardless of specificity.

Every incentives rating must cite the mechanism doc (UUID) it relies on, or
state "none found" — a `mid`/`strong` without a cited mechanism is invalid.

## Calibration examples

Precision:

- **strong** — A.2.2.9.2.2.3.3.4.2.1 "Primitive Hub Document Update"
  (`e7fc7c2e`): declared RP (Operational GovOps), trigger line, field-by-field
  update spec. Actor+trigger+action+completion all present.
- **mid** — A.2.2.4.1.1.2.2 "Removal From Integrator Program" (`0bdcef8a`):
  actor, trigger ("If Sky Governance removes…"), concrete action (remove from
  list) — but no time bound and no stated completion signal.
- **weak** — A.1.14.4.6.1.1 "Executor Agent GovOps" (`76405733`): "GovOps
  actors carry out operational activities on behalf of Executor Agents" — a
  posture, not a task; no trigger, bound, or completion.

Incentives:

- **strong** — the shared Agent Artifact maintenance duty (A.1.14.2.10.1,
  `603b2914`): Core GovOps review process with staged findings, published
  outcomes, and penalty assessment (A.1.14.2.10 / `d4bf73e7`) explicitly
  reaches it; enforcer ≠ actor.
- **mid** — Operational GovOps reward-calculation tasks (A.2.2.9.1.2.4.1.1):
  errors surface in the settlement cycle's dispute/true-up process
  (A.2.4.1.2.1.5), but no consequence for the OEA itself is quantified.
- **weak** — "Operational GovOps may contract with another actor to perform
  this work" (A.2.2.9.1.2.1.1.1.1, `e00e28d1`): no consequence anywhere for
  doing this badly; only the misalignment backstop.

## Process requirements (for the assessment layer)

- **Evidence or it didn't happen**: each row pins the task quote (verbatim, as
  in `duty_for` meta) and any mechanism UUIDs the incentives rating relies on.
- **Drift-safe**: ratings are keyed by doc UUID + a hash of the assessed quote.
  If the atlas changes the underlying text, the rating is flagged stale and
  re-queued — never silently reused (same pattern as `processes.json` triage).
- **Reasoning format**: 1–3 sentences naming the present/missing elements by
  name. The element names in this rubric are the vocabulary.
- **Automated steps** (`[automated]` RP annotations): precision is rated on the
  automation's spec; incentives are rated on the OEA's duty to supervise the
  automation, and say so.
- Ratings are drafted LLM-assisted against this rubric, then human-reviewed
  before entering the curated artifact; the rubric version is recorded with
  each rating.
