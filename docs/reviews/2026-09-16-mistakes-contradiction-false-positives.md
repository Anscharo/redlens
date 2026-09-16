# Contradiction false positives in the Potential Mistakes sweep

**Date:** 2026-09-16
**Corpus as reviewed:** `public/potential-mistakes.json` (`generatedAt` 2026-09-15, atlas SHA `d64eca4800553d21cf61cccba3c5f5a436edd256`, 11,529 documents scanned, 355 findings, 74 of them `contradiction`)
**Outcome:** the 19 rows below were moved out of `findings` into `rejected` on 2026-09-16. The live report now shows 336 findings, 55 of them `contradiction`.
**Question:** of the contradiction-category rows, which ones treat a general Atlas rule plus a nested exception or child refinement as if the two texts are incompatible?
**Method:** re-read each flagged document and the documents the sweep named as its counterpart, in the atlas checkout at that SHA. The sweep’s `quote` / `issue` / `fix` fields are taken as the claim under review; the Atlas text is ground truth. This note covers only the 19 rows whose “clash” dissolves on that reading. It does not re-litigate the rest of the 74, and it does not touch language-pass findings.

---

## Bottom line

**Nineteen contradiction rows are false positives.** One is sweep-severity `high` (Chronicle hatch wording in A.3.7.1.1.4); the other eighteen are `medium`. None of them is two Atlas documents asserting incompatible operative rules. Each is a parent (or general) rule sitting next to a child (or named) exception, a present-vs-future split the same document already states, leftover ICD columns next to a prose override, or boilerplate reused on every one-shot Primitive.

The shared detector failure: the factual pass scores **surface incompatibility of isolated sentences**. Atlas nesting is built to let a later sentence, a child, or a named special case narrow the earlier one. That is how A.1.6.8 sits beside A.1.6.6.0.3.2, how A.2.8.2.1.2.9.1 sits beside A.2.8.2.1.2.1, and how A.6.1.1.1.3.1.3.2.2 sits under A.6.1.1.1.3.1.3.2.

These 19 do not need Atlas edits on the strength of the sweep’s `fix` field. They have been moved out of `findings` into the artifact’s `rejected` list, each carrying its one-line verdict from the table below and a pointer back to this note — so the report no longer shows them, and `mergeFindings` will not let a later sweep re-add them.

---

## Verdict per finding

| Finding | Sweep sev. | Why it is not a clash |
|---|---|---|
| A.3.7.1.1.4 Chronicle hatch | high | Exclusive use “until at least” 2026-01-01, with an alternatives window *during* that lock-in for unresolvable Chronicle security concerns — a hatch inside the exclusive period, not two timelines. |
| A.2.2.2 Primitive schema | medium | Same document: all Process Definitions follow the schema; “at present” only two Primitives use it; “in future” the rest will. |
| A.6.1.1.2.2.2.2.2.1.2.1.4 Grove Wednesday / Friday | medium | Wednesday 16:00 UTC is the default Forum cut-off; the next sentence is an explicit later-Friday path for proposals that skip Core Council Risk Advisor approval. |
| A.2.8.2.1.2.9.1 USDe 50% vs 40% JRC | medium | A.2.8.2.1.2.1 is the general force-share-with-JRC cap (40%, USDS-spread base). A.2.8.2.1.2.9 is a named USDe/sUSDe deal at 50% of a broader base, paired with its own JRC rental in A.2.8.2.1.2.9.2. |
| A.1.6.8 opsec adjudication | medium | Opsec-specific “must initiate” in A.1.6.8 sits beside the general allegation discretion in A.1.6.6.0.3.2 / A.1.6.6.0.4.1 — *lex specialis*, not a clash. |
| A.1.9.1.3.1 “the two … are required to join” | medium | Names the two incident-response members who join the Signal Group. A.1.9.1.2.3 / A.1.9.1.2.3.1 already allow extra assignees; that is not a cap of two. |
| A.6.1.1.1.3.1.3.2 Spark “delegate at any time” | medium | Parent permission; children A.6.1.1.1.3.1.3.2.2 / A.6.1.1.1.3.1.3.2.3 add the snapshot lock and next-block effect. |
| A.6.1.1.2.3.1.4.2 Grove “delegate at any time” | medium | Same shape as the Spark sibling, under A.6.1.1.2.3.1.4.2.2 / A.6.1.1.2.3.1.4.2.3. |
| A.6.1.1.1.3.1.3.3.3 100% duty vs 85% floor | medium | A.6.1.1.1.3.1.3.3.3 is the duty (For/Against on every proposal). A.6.1.1.1.3.1.3.5.2 is the offboarding floor (voting percentage under 85%, or three missed in a row). A.6.1.1.1.3.1.3.3.4 is the disclosed-conflict Abstain exception. |
| A.6.1.1.4.2.1.4.2.1.1.6 emissions “permanently” | medium | Two-layer rule in one paragraph: Skybase Governance cannot re-enable; Sky Governance can, only under the Risk Framework. |
| A.5.2.1.3.1 0 USDS budget | medium | A.5.2.1.3.1 is the current appropriation (0 USDS / month). A.5.2.1.1 is the standing pay-actors duty. An unfunded duty is not a textual clash. |
| A.4.3.2.1 SKY rewards “not currently available” | medium | A.4.1.2.2.4.1 says USDS users “may be able” and points at A.4.3.2. A.4.3.2.1 is the live switch, presently off. The funding-history paragraph is not a live-rewards claim. |
| A.4.6.1.1 Pause Proxy overview | medium | Parent splits Dai/USDS via DssBlow2 vs everything else via Pause Proxy. Child A.4.6.1.1.1.2 elaborates “everything else” (other stablecoins: convert, or send to Pause Proxy). |
| A.2.2.10.1.1.1.2.1.2.1 `maxAmount` | medium | Parent A.2.2.10.1.1.1.2.1.2 already says rate limits are not a cumulative allocation cap. The child’s own example is a refillable-allowance ceiling. |
| A.2.2.10.1.1.1.2.4.1.3 unlimited lock gloss | medium | “Whether or not registered” glosses case 2 (unlimited on-chain, no default). The closing sentence is how you leave that case, not a third lock rule. |
| A.6.1.1.1.3.2.1.1.3.2.6 `max`: 0 (no cap) | medium | The parenthetical glosses `0` as unlimited in place. Sibling sDAI writes `0 sDAI` under “not a borrowable asset” (A.6.1.1.1.3.2.1.1.3.2.5). Notation drift, not two meanings of an unglossed zero. |
| A.6.1.1.1.3.2.1.1.1.3 Dai IRM leftover columns | medium | Definitional doc: Dai’s IRM is an SSR spread, independent of utilization. The Dai params ICD (A.6.1.1.1.3.2.1.1.2.1.2) still lists Slope 1 / Slope 2 / Optimal Utilization, then restates the SSR-spread rule in prose. Leftover columns, not a second IRM. |
| A.2.9.1.1.1.4.2.2.7 RTC “non-binding” | medium | “Non-binding” = no beneficiary right of action (same Article as A.2.9.1.1.1.3.3.1). “Definitive” in A.2.9.1.1.1.4.2.2.5 = the recommendation is unappealable. Payout still needs a SKY vote (A.2.9.1.1.1.4.2.2.8). |
| A.6.1.1.4.2.1.3.1.4 “no further Instances” | medium | Singleton boilerplate used on every one-shot Primitive, including Inactive ones. “No further” means the Primitive is one-shot, not “an Instance already exists.” |

---

## The pattern

Atlas documents routinely do all of the following in one subtree:

1. State a general rule on the parent.
2. Put the exception, timing, snapshot lock, or enforcement floor on a child — or in the next sentence of the same document.
3. Reuse Primitive-Directory boilerplate (“no further Instances…”) on every one-shot Primitive, regardless of `Active` / `Completed` / `Inactive`.

The sweep’s factual pass treats (1) and (2) as two claims that fight each other. That is the wrong test for this corpus. A contradiction finding here is only real when two texts assert incompatible **operative** rules with no exception, override, or present/future split between them.

---

## High: Chronicle hatch — A.3.7.1.1.4

Sweep id `A.3.7.1.1.4#contradiction` (`a38e05bf-0820-4916-a71c-cff4f54e45df`). The sweep reads the exclusive-use sentence and the alternatives sentence as two timelines that expire each other, and offers rewriting “until January 1st, 2026” to “after January 1st, 2026.”

A.3.7.1.1.4:

> The Native Vault Engine collateral types of ETH, STETH, WBTC will specifically use the Chronicle v3 oracle solution, until at least January 1st 2026. The Native Vault Engine collateral types must be migrated to the new version of the Chronicle v3 oracle when it is feasible to do so.
>
> Other oracle solutions, including diversified oracles, will only be considered until January 1st, 2026, and only if there are unresolvable security concerns with the Chronicle v3 oracles.

Reading: lock-in of Chronicle v3 through at least that date, with a hatch **during** the exclusive period if Chronicle security is unresolvable. The hatch is narrow (security only) and time-bounded (the lock-in window). That is a general exclusive-use rule plus an exception window, not “the hatch expired before it could be used.” The sweep’s rewrite (consider alternatives *after* the lock-in date) would invert the hatch: it would open alternatives only once exclusive use has already run its minimum term.

Awkward? Yes — “until at least” on one sentence and “until” on the next is easy to misread. A clash that forces an Atlas edit? No.

---

## Present vs future, in the same document — A.2.2.2

Sweep id `A.2.2.2#contradiction` (`bdbb8ac9-d87e-4052-9e69-8267f38a54cf`). The sweep stops at “all … are structured according to a common data schema” versus “at present, only … two.”

A.2.2.2 resolves this in the next sentences of the same document:

> All Sky Primitive Process Definitions are structured according to a common data schema …
>
> At present, only the Distribution Reward Primitive and the Integration Boost Primitive specifications are structured using this schema. In future iterations of the Atlas, the schema will be applied to all Primitive specifications in this Article.

The opening sentence is the schema’s design claim. The next paragraph is the rollout status. The sweep’s suggested rewrite of that opening line in A.2.2.2 is what the document already says, two sentences later.

---

## Default deadline plus an explicit later exception — A.6.1.1.2.2.2.2.2.1.2.1.4

Sweep id `A.6.1.1.2.2.2.2.2.1.2.1.4#contradiction` (`f6dd56ae-ee72-4109-be99-eaf69c92c3be`). The sweep treats Wednesday 16:00 UTC and “end-of-Friday” as two deadlines for the same act.

A.6.1.1.2.2.2.2.2.1.2.1.4:

> The cut-off time for submitting the proposal in a Forum post is Wednesday 16:00 UTC. After the cut-off time, it is at the discretion of the Operational Facilitator whether the proposal can be included in the immediate next cycle, or the following cycle.
>
> Where the proposal is risk-increasing … the Operational Facilitator triggers the Snapshot poll only after the Core Council Risk Advisor's approval has been obtained.
>
> Proposals that do not require Core Council Risk Advisor approval may instead follow the later end-of-Friday submission deadline.

Wednesday 16:00 is the default. Risk-increasing proposals wait on the Core Council Risk Advisor. Proposals that skip that approval “may instead” use Friday. The word “instead” is the exception marker the detector dropped.

---

## Named special case vs general cap — A.2.8.2.1.2.9.1

Sweep id `A.2.8.2.1.2.9.1#contradiction` (`7d16afc8-0eb4-40db-81aa-915a7f052859`). The sweep holds the 50% USDe/sUSDe share against the Accord’s 40% JRC-rental cap.

A.2.8.2.1.2.1 (`25743b88-dead-47fe-bd81-b709e69f5949`) is the general bilateral share: “up to 40% maximum with JRC rental.” A.2.8.2.1.2.1.1 (`66089224-1a28-475f-9276-ed2bd956e48e`) limits that force-share to “the spread earned on USDS debt.”

A.2.8.2.1.2.9 is a **named** USDe/sUSDe arrangement. A.2.8.2.1.2.9.1 sets 50% of a broader revenue-and-expense base (protocol yield, OTC/incentives, withdrawal rebates; mint/burn, swap, Sky borrowing costs). A.2.8.2.1.2.9.2 (`ac648f96-3b0d-46c6-9501-a3a88da26961`) pairs it with Grove renting 50% of the associated Required Risk Capital as Junior Risk Capital Rental. That is a special deal with its own rental, not a silent override of the 40% force-share cap, and not a reason to “align the figures.”

---

## *Lex specialis* — A.1.6.8

Sweep id `A.1.6.8#contradiction` (`7b0da718-62c1-4718-8d9d-47faa1647c6f`). The sweep holds the opsec “must initiate” against the general credible-evidence discretion.

A.1.6.6.0.3.2 (`578ff359-eff1-406e-8cb9-5f4807598c10`) is the general allegation threshold: where an allegation fails “credible evidence,” the Core Facilitator may decline to initiate adjudication. A.1.6.6.0.4.1 (`c5146fa6-00ec-4543-9288-410570b5d588`) (and the parallel A.1.5.8.0.4.1) is the general intake: after a preliminary review, the Core Facilitator decides whether to initiate.

A.1.6.8 is the opsec-specific Section. It says the Core Facilitator must initiate a formal adjudication where there is an allegation concerning AD breach of operational security, and must promptly derecognize the AD if there is clear evidence or significant suspicion of compromise. That is a stricter rule for one subject matter, sitting in its own Section, not a second general intake rule that cancels A.1.6.6.0.3.2. The sweep’s rewrite (thread “credible evidence” into A.1.6.8) would flatten the special rule into the general one.

---

## “The two … are required to join” is not a cap of two — A.1.9.1.3.1

Sweep id `A.1.9.1.3.1#contradiction` (`45a7ccff-09fa-4d95-b3d8-e3f34f7917cf`). The sweep reads “the two (2) team members … are required to join” as fixing Signal Group membership at exactly two.

A.1.9.1.2.3 (`c56e96cc-d5fe-4e5c-80c1-9d3074b6660a`) already says a team “should assign two (2)” and, in the next paragraph, “may assign more than two (2) … at the discretion of Core GovOps.” A.1.9.1.2.3.1 (`b41dc314-3bd6-49bb-a454-ef7a964e1a77`) expressly lets Soter Labs assign more than two to “the permissioned Emergency Response Communication Channels defined in A.1.9.1.3.”

A.1.9.1.3.1 then says those two incident-response members “are required to join the Signal Group.” That is a join duty for the default pair, not a prohibition on the extras A.1.9.1.2.3 / A.1.9.1.2.3.1 already allow. Dropping the count of two, as the sweep suggests, would erase the default pair the parent just defined.

---

## Parent permission, child snapshot lock — Spark A.6.1.1.1.3.1.3.2 and Grove A.6.1.1.2.3.1.4.2

Sweep ids `A.6.1.1.1.3.1.3.2#contradiction` (`7fcbb9da-7559-4a18-ab68-f0840a3fe921`) and `A.6.1.1.2.3.1.4.2#contradiction` (`b742c40b-2185-4468-8d86-6825f2cc90ae`). Same shape on both Agents.

Parent (Spark A.6.1.1.1.3.1.3.2 / Grove A.6.1.1.2.3.1.4.2): holders may delegate “at any time”; “the key features of delegation are specified in the subdocuments herein.”

Child snapshot lock (Spark A.6.1.1.1.3.1.3.2.2 `99c40e7d-2033-4ca2-bf8d-a2f4a8556b0d` / Grove A.6.1.1.2.3.1.4.2.2 `9bce7b3d-a978-4e18-95d4-09693dcea552`): voting power, including delegations, cannot be altered for the duration of a specific active proposal; changes show up in future votes.

Child undelegation (Spark A.6.1.1.1.3.1.3.2.3 `375d4774-24f8-4f19-9b00-1a9043891b70` / Grove A.6.1.1.2.3.1.4.2.3 `4c2ff2a4-4581-4f23-9128-9fbf33e28352`): revoke or move “whenever no proposal is live”; “all changes take effect at the next snapshot-block.”

“At any time” is the permission to submit a delegation. The children say when that permission **takes effect** relative to a live proposal. That is the nested restriction the parent announced, not a second regime. Qualifying the parent with “effective from the next snapshot block” would only duplicate A.6.1.1.1.3.1.3.2.3 / A.6.1.1.2.3.1.4.2.3.

---

## Duty vs enforcement floor vs named exception — A.6.1.1.1.3.1.3.3.3

Sweep id `A.6.1.1.1.3.1.3.3.3#contradiction` (`46e9d0bb-e251-4f07-8327-804456f2e68a`). The sweep treats 100% For/Against, an 85% offboarding floor, and Abstain as three rates that cannot coexist.

A.6.1.1.1.3.1.3.3.3 is the duty: the Delegate must cast For/Against on 100% of proposals in the voting window.

A.6.1.1.1.3.1.3.3.4 (`16eb44b8-0a93-4138-a11a-99e654727b90`) is the named exception: Abstain “may be used solely” for a documented conflict. A.6.1.1.1.3.1.3.3.4.2 then treats any other Abstain as non-performance under A.6.1.1.1.3.1.3.5.

A.6.1.1.1.3.1.3.5.2 (`ca90a844-23e2-4741-aa76-97dd1092370d`) is the removal trigger: automatic offboarding if the Delegate fails to vote on ≥ 3 proposals in a row, **or** maintains a voting percentage less than 85%.

Duty, exception, and enforcement floor are three different layers. Collapsing the duty to “≥ 85%, excluding disclosed-conflict abstentions” — the sweep’s suggested rewrite — would make the floor the duty. The Atlas keeps them apart on purpose: miss some votes and you are below the duty; miss enough and you are offboarded.

---

## Two-layer “permanently” — A.6.1.1.4.2.1.4.2.1.1.6

Sweep id `A.6.1.1.4.2.1.4.2.1.1.6#contradiction` (`f56670f9-5a43-4b47-b94a-99026f8d87c0`). The sweep reads “permanently disabled” and “Sky Governance retains the ability to revert” as a rule that cancels itself.

A.6.1.1.4.2.1.4.2.1.1.6:

> Token emissions beyond the Genesis Supply are permanently disabled; this cannot be reverted by Skybase Governance. Sky Governance retains the ability to revert where Skybase is in violation of Risk Capital requirements and emissions are required by the Risk Framework. See A.3.2 - Risk Capital.

A.6.1.1.4.2.1.4.2.1.1.6 bars Agent governance from re-enabling emissions. Sky Governance can re-enable, and only under the Risk Framework. Dropping “permanently,” as the sweep suggests, would lose the Agent-level bar the first sentence is there to state.

---

## Standing duty vs current appropriation — A.5.2.1.3.1

Sweep id `A.5.2.1.3.1#contradiction` (`65625a56-0d3e-45b3-958d-0517fd861bd2`). The sweep holds a 0 USDS monthly budget against the pay-actors duty.

A.5.2.1.1 (`a4a1d3b4-fdcc-41ec-9af6-f501376599a0`) is the standing duty: Sky must support accessibility by paying Ecosystem Actors to maintain accounts and channels.

A.5.2.1.3.1 is the current appropriation for that Section: 0 USDS per month, via DssVest, described as a monthly recurring budget. A zero appropriation does not rewrite the duty, and a DssVest of zero is how this budget is presently implemented. Whether that funding choice is good policy is outside this review; it is not two documents asserting two different amounts.

---

## “May be able” points at the live switch, which is off — A.4.3.2.1

Sweep id `A.4.3.2.1#contradiction` (`caba97e4-4d4d-4aa9-9ed4-f0d1c8b1c552`). The sweep holds “SKY token rewards are not currently available to USDS users” against A.4.1.2.2.4.1’s present-tense “may be able.”

A.4.1.2.2.4.1 (`8189e776-d631-44a0-81e5-3b2d5d88ef54`):

> USDS users may be able to earn SKY Rewards. See A.4.3.2 - Token Reward Mechanism.
>
> These rewards were previously funded by emissions of new SKY tokens.
>
> These ongoing emissions were eliminated and replaced with a solution that funds these rewards using SKY held by the Sky Protocol.

“May be able” plus an explicit pointer to A.4.3.2. A.4.3.2.1 is that mechanism’s live switch, and it says rewards are not currently available. The rest of A.4.1.2.2.4.1 is the funding-history (emissions replaced, offsetting burn). History of a funding path is not a claim that rewards are live. SPK and GROVE rewards in A.4.3.2.2 / A.4.3.2.3 are the contrast: those two **are** available, with schedule links. SKY’s row is the one that is off.

---

## Parent overview, child elaboration — A.4.6.1.1

Sweep id `A.4.6.1.1#contradiction` (`e6807f67-0d3c-4b6a-a3df-6da987147b72`). The sweep reads “Pause Proxy … for non-stablecoins” as a taxonomy that bars other stablecoins from the Pause Proxy.

A.4.6.1.1 is an overview: DssBlow2 for adding Dai and USDS to the Surplus Buffer, Pause Proxy for non-stablecoins. Child A.4.6.1.1.1.2 (`2e2e0d0b-f021-4958-8863-92cca851736f`) then says stablecoins other than Dai or USDS cannot go through DssBlow2, and “should either (1) be converted to Dai or USDS and sent to DssBlow2 or (2) be sent to the Pause Proxy contract without conversion.” Child A.4.6.1.1.2.1 sends non-stablecoins to the Pause Proxy as well.

The parent is Dai/USDS-via-DssBlow2 versus everything-else-via-Pause-Proxy. The child is the elaboration of “everything else.” Tightening the parent’s gloss would be copy-editing, not resolving a clash.

---

## Allowance ceiling vs cumulative cap — A.2.2.10.1.1.1.2.1.2.1

Sweep id `A.2.2.10.1.1.1.2.1.2.1#contradiction` (`8b5f1ffd-9dfd-4aa0-8fc2-638a79d9fadb`). The sweep holds “hard cap on the level of allocation … at any given time” against the parent’s “do not act as a limit on the total amount.”

A.2.2.10.1.1.1.2.1.2 (`8efb0a11-b798-48eb-af19-f65b38f039b5`) defines `currentRateLimit = min(slope * (block.timestamp - lastUpdated) + lastAmount, maxAmount)` and then: “Rate limits set caps on the rate of allocation to a given Instance, they do not act as a limit on the total amount that may be allocated to that Instance.”

A.2.2.10.1.1.1.2.1.2.1’s own example is that same refillable ceiling: if `maxAmount` is 1,000,000, the rate limit grows until it hits 1,000,000, stops, and resumes after an allocation. “Level of allocation … at any given time” is clumsy for “available allowance now,” but it is the parent’s formula, not a cumulative Instance cap. The suggested rewrite (“hard cap on the rate limit’s available allowance”) is a wording nit, not a contradiction fix.

---

## Gloss of case 2, not a third lock rule — A.2.2.10.1.1.1.2.4.1.3

Sweep id `A.2.2.10.1.1.1.2.4.1.3#contradiction` (`92a74fe1-3115-4cd7-bbf8-4e16fb4b0aa8`). The sweep treats “whether or not it was ever registered” as a third lock case that fights the two enumerated cases and the closing sentence.

A.2.2.10.1.1.1.2.4.1.3 lists two cases in which a rate limit is locked as unlimited:

- It has a default of the unlimited value.
- It already holds that value on the `RateLimits` contract and has no default at all. “A rate limit that is already unlimited is locked the same way whether or not it was ever registered.”

Then: “Registering a default other than the unlimited value removes that lock.”

The middle sentence of A.2.2.10.1.1.1.2.4.1.3 glosses case 2: unlimited on-chain, no default — registration is how a default appears, so “whether or not registered” is “this lock does not depend on having gone through `addInitRateLimits`.” The closing sentence is how you **leave** case 2 (register a finite default). An unlimited rate limit that already carries a finite registered default is in neither case. Narrowing the gloss, as the sweep suggests, would be clearer prose; it is not needed to make the three sentences cohere.

---

## Glossed zero vs unglossed zero — A.6.1.1.1.3.2.1.1.3.2.6

Sweep id `A.6.1.1.1.3.2.1.1.3.2.6#contradiction` (`07f1853e-ec34-44ae-b137-708a81cd3195`). The sweep treats `max`: `0 (no cap)` as giving 0 a second meaning that fights the `max` definition and the sDAI row.

A.6.1.1.1.3.2.1.1.3.1.3 (`35323a90-f863-4fad-b6ca-9968a163a76d`) defines `max` as “the maximum the Supply Cap or Borrow Cap can be increased to.” WETH (A.6.1.1.1.3.2.1.1.3.2.1) writes unlimited as `Unlimited`. USDC (A.6.1.1.1.3.2.1.1.3.2.6) writes `0 (no cap)` — the parenthetical is the gloss. sDAI (A.6.1.1.1.3.2.1.1.3.2.5 `21bdfe50-0996-494d-8413-1d41966fb4f6`) writes borrow-cap `max`: `0 sDAI` under “n/a - not a borrowable asset.”

That is inconsistent notation across siblings (Unlimited vs `0 (no cap)` vs `0 sDAI` for a non-borrowable market). It is not two operative meanings of a bare 0. Preferring WETH’s `Unlimited` is a style note, not a contradiction.

---

## Leftover ICD columns next to a prose override — A.6.1.1.1.3.2.1.1.1.3

Sweep id `A.6.1.1.1.3.2.1.1.1.3#contradiction` (`9006fd8d-bd13-48fc-bf2f-04f47579b3b0`). The sweep treats Dai’s Optimal Utilization / Slope 1 / Slope 2 ICD columns as a utilization-dependent IRM that fights the definitional sentence.

A.6.1.1.1.3.2.1.1.1.3 defines the four-parameter IRM for “all markets except Dai,” then: “The IRM for Dai is independent of utilization and is defined as a spread over the Sky Savings Rate.”

A.6.1.1.1.3.2.1.1.2.1.2 (`7d8ed55b-4aca-483b-af6d-24badb49d042`) still lists Optimal Utilization 80%, Slope 1 `SSR + 1.25%`, Slope 2 15% — the generic IRM column set — and then, in the same document: “The Dai Borrow Rate is set through the Interest Rate Model as a spread over the Sky Savings Rate. The spread is set directly by the Core Facilitator in consultation with the Core Council Risk Advisor.”

The ICD template still has slope columns. Both the definitional doc and the closing prose of the params doc say Dai is an SSR spread, independent of utilization. Leftover columns are sloppy; they are not a second IRM. The sweep’s “unclear — needs author” is the wrong posture: the prose already picks the winner.

---

## “Non-binding” vs “definitive” vs the SKY vote — A.2.9.1.1.1.4.2.2.7

Sweep id `A.2.9.1.1.1.4.2.2.7#contradiction` (`99079da7-e8e9-4660-96a6-269625d821cc`). The sweep treats “non-binding,” “definitive / not subject to appeal,” and “payout … subject to the approval of the Resilience Technical Committee” as three statuses of the same act.

A.2.9.1.1.1.3.3.1 (`5b88e18f-dadc-47b2-af7c-e9ff8039d39e`): beneficiaries “do not have any acquired right or claim”; payout is “subject to the approval of the Resilience Technical Committee (at their sole and absolute discretion) and further contingent on a SKY vote endorsing payment of the claim.”

A.2.9.1.1.1.4.2.2.5 (`313d72e5-62db-4dd4-b125-97467508f44c`): the Technical Committee’s recommendations “are made in their sole and absolute discretion, are definitive, and are not subject to appeal.”

A.2.9.1.1.1.4.2.2.7: those recommendations “are non-binding and will not give rise to any right or claim to the beneficiaries nor give rise to any obligation or responsibility.”

A.2.9.1.1.1.4.2.2.8 (`bf63fc62-3555-4b9b-a561-053fb35721b5`): “Based on the recommendation … the Core Facilitator will decide whether to trigger a Governance Poll … to perform a claim payout.”

Three different legal facts, all in the same claim path:

- The rec is unappealable as a rec (A.2.9.1.1.1.4.2.2.5).
- The rec creates no private right or Fund obligation (A.2.9.1.1.1.4.2.2.7) — the same “no acquired right” already in A.2.9.1.1.1.3.3.1.
- Payout still runs Core Facilitator → SKY vote (A.2.9.1.1.1.4.2.2.8), which is why A.2.9.1.1.1.3.3.1 can say both “subject to RTC approval” and “further contingent on a SKY vote” without the rec itself paying anyone.

The sweep’s “unclear — needs author; pick binding or advisory” flattens a two-step (RTC rec, then SKY vote) into one.

---

## Singleton boilerplate on an Inactive Primitive — A.6.1.1.4.2.1.3.1.4

Sweep id `A.6.1.1.4.2.1.3.1.4#contradiction` (`09e544ef-8565-49d2-8dd6-e1b0aa53cb21`). The sweep reads “no further Instances … can be Invoked” as presupposing that one Instance already exists, which would zero out an `Inactive` Primitive with empty Active/Completed directories.

A.6.1.1.4.2.1.3.1.1 (`b1246162-614d-42b8-b648-474ba79b22aa`) is `Inactive`. A.6.1.1.4.2.1.3.1.4 then uses the one-shot Primitive sentence:

> Because the Executor Transformation Primitive is deployed solely for the one-time transformation of the Agent, no further Instances of the Primitive can be Invoked.

That sentence is reused across Agent Creation, Prime Transformation, Executor Transformation, Agent Token, and Root Edit — including on Completed/Active Primitives that do have an Instance, and on Inactive ones that do not. “No further” is the Primitive’s cardinality (one-shot), not a claim that the one shot has already happened. Using in-progress-Directory wording for an un-Invoked Primitive, as the sweep suggests, would break the pattern every other one-shot Primitive uses.

---

## Out of scope of this note

- The other 55 contradiction rows (including the 12 previously marked uncertain). Those are a different pile: some look load-bearing, some still need an author, none of them share this “general + nested exception” misread as cleanly.
- Language-pass false positives (title-equality Spark xrefs, copy-edit nits).
- Confirmed real findings in other categories (for example LGD `min(...,0)` in A.3.2.2.1.1.1.1.1.2, DAB as a subset of ASC in A.3.3.2.3.1, Grove “5% of 3B” as 500M in A.2.8.2.2.2.1.2.1, burn `WAD*1` as 55% in A.3.5.2, Spark `100,000,00`, “proscribed” in A.1.1.3.1.0.6.1). This note does not reopen them.

---

## What this implies

**These 19 are now vetoed in the data, not just in this note.** Each sits in `rejected` in `public/potential-mistakes.json` with its verdict and a link here. `suppressRejected` (`scripts/lib/mistakes-sweep.mjs`) drops an incoming finding that repeats a rejected `(uuid, category, quote)`, so re-sweeping any of these documents cannot quietly put them back. The veto is deliberately keyed on the quoted text: **if the Atlas rewrites the passage, the veto lapses and the finding can return** — which is exactly when a human should look at it again.

If the factual prompt is retuned, the cheap fix is: **do not emit `contradiction` when the counterpart is a child of the flagged doc, the next sentence of the same doc, or a named special-case heading, unless the two texts still assert incompatible operative rules after that structure is applied.** The graph already knows that structure — `parent_of` edges give the parent/child test directly, and every one of these 19 now carries a UUID to look up.
