# Distribution Reward — New Partner Onboarding Checklist

What Operational GovOps must collect from the Prime Agent and from the new partner
(integrator) to onboard a Distribution Reward partner, and the full onboarding
sequence. Every requirement links to its source section in the Atlas reader.
Verified against atlas commit `db87434` (2026-07-21); all 28 citations
UUID-checked against the live corpus.

Scope note: Distribution Reward and Integration Boost share one Integrator
Program, one application process, one Reward Code space, and the same registries
([A.2.2.4.1 — Integrator Program](https://atlas.redline.support/atlas?id=37c38f07-b5a0-40df-939c-a54330ea3c7b)).
This checklist is scoped to DR; the differences are flagged at the end.

---

## Information to collect — from the new partner

- [ ] **Application** — submitted directly to Operational GovOps under the current
      near-term process (long-term: routed through a Prime Agent)
      · [A.2.2.4.1.2.1 — Near Term Process](https://atlas.redline.support/atlas?id=7fe5dbb2-a07d-4ef9-94de-f54a2d568c57)
      · [A.2.2.4.1.2.2 — Long Term Process](https://atlas.redline.support/atlas?id=6283379c-d871-40a9-a915-d716d7df5642)
      > ⚠ The Atlas does NOT enumerate required application fields. Implied
      > minimum: legal identity + jurisdiction, contact persons, frontend /
      > integration details, USDS integration plan, expected volume. OGO should
      > maintain its own form (governance gap — see "Gaps" below).
- [ ] **Alignment evidence** — the partner must be aligned with Sky's USDS
      adoption strategy; the determination is solely OGO's, and Sky Core may
      revoke a Reward Code at its sole discretion
      · [A.2.2.4.1.1.1 — Alignment](https://atlas.redline.support/atlas?id=98e98f68-e749-4d0a-8972-7e36ed166326)
- [ ] **Compliance warranty** — representation of full compliance with all
      applicable laws and regulations in every jurisdiction where the partner
      operates (frontend, marketing, promotion, protocol access); participation
      is contingent on ongoing compliance
      · [A.2.2.4.1.1.2 — Compliance With Local Laws And Regulations](https://atlas.redline.support/atlas?id=f3b4b43d-b2e5-4f56-aeac-9627d3acc31e)
      > Non-compliance (determined, suspected, or alleged) lets governance
      > withhold, revoke, or claw back rewards
      > · [A.2.2.4.1.1.2.1 — Consequence For Integrator Non-Compliance](https://atlas.redline.support/atlas?id=a01622fa-e81c-4bcb-8e31-7e66e36f2e57)
- [ ] **Partner-side tracking inputs** — the contract addresses and/or off-chain
      data sources through which the partner's USDS balances will be attributed;
      off-chain data must be verifiable against on-chain data
      · [A.2.2.9.1.2.1.1.2.1 — Ethereum Mainnet General Tracking Methodology](https://atlas.redline.support/atlas?id=87fd6861-ba8a-4bde-945e-ee9ad37ae3e2)
      · [A.2.2.9.1.2.1.1.2.3 — Base Tracking Methodology](https://atlas.redline.support/atlas?id=f710bddf-dc1d-483c-9503-483574cb6333)

## Information to collect — from the Prime Agent

- [ ] **Reward Code assignment** — a unique code from that Prime's reserved
      range (Skybase `0`,`1`,`1000–1999` · Spark `2–999` · Grove `2000–2999` ·
      Keel `4000–4999`)
      · [A.2.2.9.1.2.1.1.4 — Reward Code Ranges](https://atlas.redline.support/atlas?id=af47ab9b-ee80-4352-89db-9c7d819395c2)
- [ ] **The joint Tracking Methodology** — developed by the Prime together with
      the partner; on-chain (Reward Code tagged on Sky Savings Rate / Token
      Rewards deposits) or off-chain
      · [A.2.2.9.1.2.1.1.2.1 — Tracking Methodology](https://atlas.redline.support/atlas?id=87fd6861-ba8a-4bde-945e-ee9ad37ae3e2)
- [ ] **New DR Instance parameters** — the Instance Configuration content for the
      invocation: partner name, Reward Code, methodology reference; instance
      enters `Pending` status
      · [A.2.2.9.1.2.3 — Instance Invocation Protocol](https://atlas.redline.support/atlas?id=ad3a3f6b-7bc3-4e5f-b1c3-225b5b4cbe15)
- [ ] **(Nothing to collect on reward sharing)** — the reward (fixed 0.2%/yr
      · [A.2.2.9.1.2.1.2 — Distribution Reward Rate](https://atlas.redline.support/atlas?id=57384c49-e499-4c69-b22c-8e1f1dd34759))
      is always paid to the Prime managing the relationship; any sharing with the
      partner is bilateral and the Atlas requires no disclosure
      · [A.2.2.4.2 — Reward Recipient And Sharing](https://atlas.redline.support/atlas?id=40395562-d447-4c85-b670-c08d2341bcd2)

---

## Onboarding sequence

### Phase 1 — Application & approval (partner ↔ OGO)

- [ ] Receive application (Sky Forum thread per the near-term process)
      · [A.2.2.4.1.2 — Integrator Applications](https://atlas.redline.support/atlas?id=abc79583-78da-4578-9ae0-51dc322ed1cb)
- [ ] Record it: add row to the applications register (Active Data, Direct Edit,
      OGO is Responsible Party)
      · [A.2.2.4.1.2.1.1 — Integrator Program Applications](https://atlas.redline.support/atlas?id=d251bbac-df0e-4aff-a26b-33d60e153e19)
      · [A.2.2.4.1.2.1.1.0.6.1 — List Of Integrator Applications](https://atlas.redline.support/atlas?id=30db9618-ddf2-4df7-ad81-3f8f3395ff62)
- [ ] Assess the alignment gate (discretionary; no enumerated criteria)
- [ ] Collect the compliance warranty
- [ ] Approve (or request revisions), coordinate with the interested Prime
- [ ] Issue the Reward Code from the Prime's reserved range

### Phase 2 — Tracking plan & onboarding registry (Prime + partner + OGO)

- [ ] Prime + partner jointly develop the tracking plan
      · [A.2.2.9.1.2.3.1.2 — Process Flow](https://atlas.redline.support/atlas?id=75ff9b92-47e1-454f-864b-b74742df918e)
- [ ] **OGO review gate** — verify BOTH: (1) OGO can operationalize the proposed
      mechanism, and (2) it accurately reflects USDS usage attributable to the
      partner; off-chain data verifiable on-chain. Reject → revise → resubmit
      · [A.2.2.9.1.2.3.2.2 — Process Flow (OGO review)](https://atlas.redline.support/atlas?id=ef743f33-32b0-4a51-af00-a9e35c2e1017)
- [ ] Add row (partner name + Reward Code) to the onboarding registry
      · [A.2.2.9.1.2.1.4.2 — Onboarding Integrators](https://atlas.redline.support/atlas?id=9a7f47ae-760f-44b5-9b5f-dd4fef86e1cc)
      · [A.2.2.9.1.2.1.4.2.0.6.1 — List Of Onboarding Integrators](https://atlas.redline.support/atlas?id=eb644108-94fc-430f-ae5a-e3294b9dd9be)
      · update rule: [A.2.2.9.1.2.3.1.4.1.1 — Onboarding Integrators Active Data Update](https://atlas.redline.support/atlas?id=6857396f-f0ce-4471-8e48-ed5f06b86830)

### Phase 3 — Instance invocation & vote (Prime + Operational Facilitator)

- [ ] Prime drafts the Artifact Edit adding the DR Instance (name, Reward Code,
      methodology reference; status `Pending`)
- [ ] Prime triggers the Artifact Edit Proposal; Operational Facilitator sets up
      the Snapshot vote; Prime token holders vote
- [ ] If approved: Operational Facilitator updates the Agent Artifact — Instance
      status → `Active`
      · [A.2.2.9.1.2.3 — Instance Invocation Protocol](https://atlas.redline.support/atlas?id=ad3a3f6b-7bc3-4e5f-b1c3-225b5b4cbe15)

### Phase 4 — Final registry updates (OGO)

- [ ] Delete the partner's row from Onboarding Integrators
      · rule: [A.2.2.9.1.2.3.6.4.1.1 — Onboarding Integrators Active Data Update](https://atlas.redline.support/atlas?id=4287ecd9-5ba6-4646-b949-306b494a108c)
- [ ] Add the partner (name, Reward Code, approved-proposal reference) to
      Current Integrators
      · [A.2.2.9.1.2.1.4.1 — Current Integrators](https://atlas.redline.support/atlas?id=883f1b52-a6d2-417b-bb24-12917de83b53)
      · [A.2.2.9.1.2.1.4.1.0.6.1 — List Of Current Integrators](https://atlas.redline.support/atlas?id=efbe7903-a76e-40f0-a440-56e463283157)
      · rule: [A.2.2.9.1.2.3.6.4.1.2 — Current Integrators Active Data Update](https://atlas.redline.support/atlas?id=1c0708d0-6388-4264-90f2-7a0d0b877012)

### Phase 5 — Ongoing operations (OGO)

- [ ] Monthly: calculate the DR per the Tracking Methodology; pay to the Prime's
      buffer (near-term: paid from the Demand Side Buffer within 7 days of
      month-end)
- [ ] Ongoing: monitor compliance; escalate suspected violations
- [ ] On removal from the program: delete from Current Integrators AND deactivate
      all of the partner's DR + Integration Boost instances
      · [A.2.2.4.1.1.2.2 — Removal From Integrator Program](https://atlas.redline.support/atlas?id=0bdcef8a-b851-42ed-b2e2-77d85c14dad0)

---

## DR vs Integration Boost partners

Same program, application, Reward Codes, and registries
([A.2.2.9.1.2.1.4 — Current And Onboarding Integrators](https://atlas.redline.support/atlas?id=f3952cc5-cde2-46b9-b575-034dda83570b)).
Differences: DR partners are **access frontends** earning a flat 0.2%/yr; IB
partners are **DeFi protocols holding USDS** earning SSR × unrewarded balance
([A.2.2.9.2.2.1.1 — Integration Boost Partners](https://atlas.redline.support/atlas?id=31cb3b86-0125-4a04-996f-634b75b6cea2)).
For IB, reporting net USDS balances is itself an accepted tracking methodology
([A.2.2.9.2.2.1.4.1](https://atlas.redline.support/atlas?id=a4ca2e70-d013-4c54-8e17-1d6f352ddbc0)).

## Gaps the Atlas leaves to OGO procedure design

- No application form/template or enumerated fields
- No published alignment criteria (pure OGO discretion)
- No compliance audit mechanism or cadence
- No reward-sharing disclosure requirement
- No auxiliary-account / data-endpoint registration requirement
- No data format or frequency spec for off-chain tracking submissions
- No SLAs on OGO review or approval timelines
