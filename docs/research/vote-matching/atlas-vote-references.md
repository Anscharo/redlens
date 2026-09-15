# Atlas references to governance votes / actions — census (2026-09-15)

Source: `public/docs.json` (11,529 nodes, atlas commit `d64eca48…`). Scanner: a throwaway session script (the final regex family is reproduced verbatim in §8 below). Example doc `ff3aa296-…` (A.2.4.1.2.2.1.2 Stage 1 Timing) reads verbatim: *"Stage 1 applied to the period from July 1, 2025 through October 31, 2025. Stage 1 was first implemented in the September 18, 2025 Executive Vote."* It has **no** `.0.3.X` annotation children (checked by parentId and by doc_no prefix); its parent A.2.4.1.2.2 "Implementation Stages" and siblings (Stage 2 Timing: *"Stage 2 was first implemented in the Monthly Settlement Cycle conducted in January 2026"*; Stage 3 Timing: *"will be specified in a future iteration of the Atlas"*) show the two implicit forms the census had to add: MSC-conducted-in-month and future-iteration deferrals.

## 1. Totals

| Category | What it means | Unique docs | Best-precision patterns |
|---|---|---|---|
| **A** explicit, specific vote/action (date, id, link, record row) | 60 | a1 dated Executive Vote (17 docs / 19 hits, 14 distinct dates), a2 "MSC conducted in <Month YYYY>" (5/7), a4 vote-portal URL (8), a6 forum thread URL (11 docs / 70 hits), a9 dated governance record rows in Active Data tables (2 docs / 23 rows), a3 MIP106 dated (1), a5 poll id (1), a11 dated Facilitator decision (1) |
| **B** vote happened, no specifics | 16 | b3 "Sky Governance hereby consents/authorizes" (9), b2 already/previously approved (4), b1/b4/b5/b6 (1 each), + 1 phrase found only by MCP semantic search ("MKR holders have voted to approve", A.4.1.2.1.1) |
| **C** forward-looking commitment | 78 (≈35 genuine; see §3) | c3 "authorized to proceed directly to an Executive Vote" (13), c1 scheduling-into-a-named-vote phrasing (20, ~14 genuine; e.g. A.2.8.2.3.2.3 · `7df88d38`), c2 "in a future/next/upcoming Executive Vote" (11, ~4 genuine), c4 "Beginning with the <date> Executive Vote" (1), c8 "will be specified in a future iteration of the Atlas" (39 — deferral, not a vote pledge; borderline) |
| **D** mechanism / normative (noise floor) | 875 | d4 Spell (345 docs / 951 hits, 863 of them in A.1.10), d1 Executive Vote (240/346), d16 vot* generic (427/809), d8 Sky Governance (157/192), d15 poll* (121/209), d2 Governance Poll (78/104), d7 cycles (94/176), d5 AEP/Atlas Edit Proposal (59/118), d11 "requires an Executive Vote" (36), d14 "approved by Sky Governance" normative (29), d12 "without a Governance Poll" (22), d17 Root Edit token vote / Snapshot (19) |
| A∪B∪C | any *particular* vote/action | **135** | overlaps: A∩B 6, A∩C 13, B∩C 1 |
| D only | mechanism talk with no particular vote | 793 | any category at all: 928 docs (8.0% of atlas) |

Per-pattern table (matches / docs) — from `node scan3.mjs table`:

| pattern | cat | matches | docs |
|---|---|---|---|
| a1_dated_exec_vote | A | 19 | 17 |
| a2_msc_conducted_in | A | 7 | 5 |
| a3_mip_dated | A | 1 | 1 |
| a4_vote_portal_url | A | 17 | 8 |
| a5_poll_or_exec_id | A | 2 | 1 |
| a6_forum_thread_url | A | 70 | 11 |
| a7_forum_dated_spell_thread | A | 6 | 3 |
| a8_exec_votes_repo_url | A | 40 | 18 |
| a9_dated_gov_record_row | A | 23 | 2 |
| a10_aep_number | A | 0 | 0 |
| a11_dated_governance_decision | A | 1 | 1 |
| b1_was_done_in_vote | B | 1 | 1 |
| b2_already_approved | B | 4 | 4 |
| b3_hereby_consents | B | 9 | 9 |
| b4_gov_decision_ratified | B | 1 | 1 |
| b5_following_ratification | B | 1 | 1 |
| b6_occurred_in_vote | B | 1 | 1 |
| c1_will_be_in_vote | C | 20 | 20 |
| c2_future_exec_vote | C | 11 | 11 |
| c3_direct_to_exec | C | 13 | 13 |
| c4_beginning_with | C | 2 | 1 |
| c5_subject_to_vote | C | 10 | 9 |
| c6_pending_approval | C | 0 | 0 |
| c7_once_ratified | C | 0 | 0 |
| c8_future_iteration | C | 39 | 39 |
| d1_executive_vote | D | 346 | 240 |
| d2_governance_poll | D | 104 | 78 |
| d3_ratification_poll | D | 11 | 4 |
| d4_spell | D | 951 | 345 |
| d5_aep | D | 118 | 59 |
| d6_atlas_edit_cycle | D | 56 | 34 |
| d7_gov_cycles | D | 176 | 94 |
| d8_sky_governance | D | 192 | 157 |
| d9_out_of_schedule | D | 12 | 11 |
| d10_voting_portal | D | 21 | 19 |
| d11_requires_vote | D | 46 | 36 |
| d12_no_vote_needed | D | 22 | 22 |
| d13_must_be_approved_via | D | 4 | 4 |
| d14_approved_by_gov_normative | D | 29 | 29 |
| d15_polls_generic | D | 209 | 121 |
| d16_vote_generic | D | 809 | 427 |
| d17_root_edit_token_vote | D | 24 | 19 |

Zero-hit vocab from the brief: "Adoption Poll" 0, "Signal Request" 0, "AEP#<n>" 0 (only the template `AEP#:` in A.1.12.2.3), "pending … approval" 0, `Executive Vote of/on <date>` 0 (the atlas always writes the date *before* the noun: "the September 18, 2025 Executive Vote"), spell contract addresses 0 (no `0x…` is ever labelled a Spell; the only "spell address" mention is the forum handover thread), vote.sky.money poll/executive ids 0 (only `vote.makerdao.com/polling/QmcZNZg3`).

## 2. Category A — explicit specific votes (60 docs)

**a1 dated Executive Vote** — 14 distinct dates, all `Month d, yyyy` immediately before "Executive Vote" (once "Out-Of-Schedule Executive Vote"). Past-tense (the vote happened): June 26 2025 (×2), Sep 18 2025 (×2), Oct 2 2025, Oct 30 2025, Nov 13 2025 (×2), Nov 17 2025 OOS. Future-tense at authoring time (now all past today except the last three): Jan 29 2026 (×2), Mar 26 2026 (×4), Apr 9 2026, Jun 18 2026, Jul 16 2026, Aug 27 2026.
- [A.4.1.2.2.4.2.1] Disabling Legacy Conversion Contract `1b8248bf-5d88-4d67-8c4a-21981a0aa937`: "The disabling of the Legacy Conversion Contract was executed in the June 26, 2025 Executive Vote."
- [A.4.1.2.1.1.1.1] MKR To SKY Upgrade Penalty `ec820ddb-5d12-43d8-81b7-a7602a70332a`: "In the September 18, 2025 Executive Vote, the Delayed Upgrade Penalty for the MKR to SKY conversion contract was set to 1%. The Delayed Upgrade Penalty will be increased gradually at the rate of 1 percentage point per 3 months thereafter."
- [A.4.2.2.2.2] Deployment (Solana SkyLink) `593095a6-aec4-4ca5-9c2e-87ce748ac198`: "The first phase occurred in the November 13, 2025 Executive Vote and the second phase occurred in the November 17, 2025 Out-Of-Schedule Executive Vote."
- [A.2.8.2.4.2.1.2.1] Transfer Of Genesis Capital Allocation To Obex SubProxy `c39702fb-bb6a-43c7-b208-18ddd279b1d3`: "…must be included in the November 13, 2025 Executive Vote. This action is authorized to proceed directly to an Executive Vote without a prior Governance Poll."
- [A.2.2.10.1.1.1.2.4.5] Transitional Measures `d5240aa5-72c1-4f92-b22c-7a80a35d733c`: "The PAS launches with the Timelock paused, as a transitional measure, via the August 27, 2026 Executive Vote."
- [A.1.10.2.5.1.2.1.1] Agent Spell Reviewer Checklist `badd8b62-dffe-4778-b5e2-78c76195242d`: "Beginning with the June 18, 2026 Executive Vote, a completed Agent Spell Reviewer Checklist must be included … Beginning with the July 16, 2026 Executive Vote, each Agent Spell Reviewer…"

**a2 Monthly Settlement Cycle conducted in <Month YYYY>** (implicit: settlement is paid "in the next Sky Core Executive Vote", A.2.4.1.2.1.3) — 5 docs in A.2.4.1.2.1.5.x / A.2.4.1.2.2.2.2; months: September 2025, October 2025, December 2025 (negated: "There was no Monthly Settlement Cycle conducted in December 2025"), January 2026 (×3).
- [A.2.4.1.2.1.5.4] `5aa66a15-d59c-4f66-9d80-96583698f24d`: "Instead, the Monthly Settlement Cycle conducted in January 2026 was for the two (2) month period from November 1, 2025 to December 31, 2025."

**a3/a5 ids** — [A.2.9.1.1.1.3.5] `9de7d51b-32f3-4746-b97d-9eb75a189cb6`: "Coverage under this Artifact is available following the ratification of MIP106 on 2023-03-27 ("Effective Date")." [A.4.1.2.1.1] MKR To SKY Upgrade Approval `eaa5f1ae-f336-49f8-b5d3-7bb01984ba0e`: "**MKR holders have voted to approve the deprecation of MKR … See https://vote.makerdao.com/polling/QmcZNZg3" (truncated poll slug — the only poll id in the atlas).

**a9 dated governance-record rows** (Active Data tables, ISO dates + forum "Reasoning Post" column): [A.1.5.10.2.0.6.1] Derecognized Alignment Conservers `e7aec672-ed19-4329-aaf7-736950be2eb7` (rows 2023-06-08 Bulwark … 2026-01-27; 16 rows) and [A.1.6.6.1.3.0.6.1] Aligned Delegate Breach Registry `1ddd9cf6-3f93-4a33-8c1d-80405eec1ffb` (2026-05-15 … 2026-06-11; 7 rows). These are Core Facilitator actions, not on-chain votes, but they are the atlas's only dated per-event governance ledger. Also [A.2.8.1.2.0.6.1] Dispute Resolutions: "**Dispute Between Spark And Grove …** (September 2, 2025) - [Facilitator Decision on Grove/Spark Dispute](…/27141)".

Clusters: A.1.10 (Executive process runbook; URLs to tooling) 26 docs, A.2.8 (Ecosystem Accords: Genesis Capital + Foundation grants) 13, A.2.4 (MSC) 6, A.4.1/A.4.2 (MKR→SKY, SkyLink bridges) 5, A.1.6/A.1.5 Active Data ledgers 3. Types: Core 53, Active Data 5, Annotation 1, NR 1.

## 3. Category B / C — implicit past and forward-looking

**B (16 docs).** The dominant form is the Atlas *itself* acting as the approval record: "Sky Governance hereby consents to these grants and authorizes the execution of the associated funding payloads as specified in the referenced proposal." — 9 Grant Authorization docs, A.2.8.2.2.2.4.4.1, A.2.8.2.2.2.4.5.1.1–4 (Spark), A.2.8.2.2.2.4.5.2.1–3 (Grove), A.2.8.2.7.2.2.3.1 (Skybase). Three of them link the dated forum spell post they were approved in (a7): `forum.skyeco.com/t/december-11-2025-proposed-changes-to-spark-for-upcoming-spell/27481`, `march-26-2026-…/27770`, `june-18-2026-…/27952`. Others: [A.6.1.1.1.3.4.1.2] Preapproved Subdao Proxy Activities `8a421648-d732-44c1-8666-bbbb9b7bfff2`: "Dispositions of Spark SubDAO Proxy assets that have already been approved by governance and added to the Spark artifact"; [A.2.9.1.1.1.4.1.6] `980b1bb1-…`: "PoEs rely on a governance decision that was ratified by an Executive Vote." (template/normative — borderline). Note the regex lane's precision problem here: "ratified by Sky Governance" (A.1.10.2.2.1.2, six A.6 multisig "Modification" docs) is normative ("changes … that have not been ratified by Sky Governance … treated as malicious"), so it was moved to D (d14).

**C (78 docs; ≈35 genuine commitments).** Genuine specific pledges cluster in A.2.8 Genesis Capital Allocation docs (7: Spark, Keel, Obex, Osero, Skybase ×2, Amatsu, Ozone — all "will/must be included in the <date> Executive Vote. This action is authorized to proceed directly to an Executive Vote without a prior Governance Poll."), protocol deployments ([A.3.5.2.2.2] Kicker "will be executed in the October 30, 2025 Executive Vote"; [A.4.2.2.3.2] Avalanche SkyLink "will be deployed in the April 9, 2026 Executive Vote. The timing may be modified by the Core Facilitator"; [A.4.2.2.4.2] Plasma SkyLink `44af823e-841b-4b2e-a4dd-363925a8bf7b`: "will be deployed in a future Executive Vote"), one-off payments ([A.4.1.1.1.1] Gnosis Payment `8f721d05-6f9b-4efe-b737-18f634f9703d`: "This payment should be included in the next available Executive Vote as determined by the Core Facilitator and is authorized…"; [A.2.8.2.2.2.4.5.1.1]: "Transfers for subsequent months will be made proportionally in Spark Spells included in…"), and process cut-overs (Agent Spell Reviewer Checklist, above). The rest of c1/c2/c5 are normative ("The `lerp` must be activated in an Executive Vote", "subject to a SKY vote pursuant to standard governance processes" ×4 in A.1.13, "subject to prior Spark governance approval via polling") and belong with D. c8 (39 docs, "will be specified in a future iteration of the Atlas") is a deferral to a future AEP, not a vote pledge — counted but excluded from the ≈35.

Forward-looking dates found: Jan 29 2026, Mar 26 2026, Apr 9 2026, Jun 18 2026, Jul 16 2026, Aug 27 2026 (all `Month d, yyyy`); quarter/"by Q3" forms: 0 attached to a vote (Q1–Q3 2026 appear only as grant coverage periods). Relative forms: "next Executive Vote" 5, "next available/possible Executive Vote" 2, "future Executive Vote" 1, "upcoming Spell" 1, "within approximately 30 days of the poll passing" (A.1.11.1.3.0.3.3 annotation).

## 4. Category D — where the noise lives
875 docs. A.1.10 (Executive Vote / Spell runbook) alone is 396 docs and 863 of the 951 "Spell" hits; A.6.1 agent artifacts 94 (Root Edit Token Holder Vote / Snapshot poll — 6 near-identical copies, one per Prime — plus multisig "Modification" clauses); A.2.2 primitives 72; A.1.11/A.1.12 cycles 69; A.1.6 delegates 28. Supporting-doc types: 20 Annotations, 9 Action Tenets, 3 Scenarios, 7 Type Specs. Out-Of-Schedule: 11 docs, all normative except the Solana SkyLink one above. Spark/Grove-level votes ("Spark governance … via polling", Snapshot) are a distinct mechanism in A.6.1.1.1.3.9.x and the Root Edit docs — no specific instance is ever dated.

## 5. URL families (deduped per doc; hits/docs)
| host / path | urls | docs | id/slug format, notes |
|---|---|---|---|
| forum.skyeco.com/t/<slug>/<topic-id>[/<post-no>] | 37 | 11 | topic ids 11836–27995; 3 dated spell threads `<month>-<d>-<yyyy>-proposed-changes-to-spark-for-upcoming-spell/<id>`; `sky-core-executive-vote-address-handover-thread/27995` (A.1.10.2.4.12.2.11); 27 AD recognition/derecognition threads in three Active Data ledgers; `facilitator-decision-on-grove-spark-dispute/27141` |
| github.com/sky-ecosystem/executive-votes | 14 | 12 | `processes/spell-sheet-creation.md` ×6, `executive-doc-creation-checklist.md`, `active/proposals.json` — process docs, never a specific spell |
| github.com/sky-ecosystem/pe-checklists/…/spell/*.md | 11 | 3 | Registered Spell Checklists Active Data (A.1.10.2.5.1.3.2.0.6.1) |
| github.com/sky-ecosystem/next-gen-atlas | 8 | 8 | Root Edit docs; no PR/AEP numbers |
| github.com/sky-ecosystem/{Spells-mainnet, dss-exec-lib, developerguides} | 3 | 3 | repo roots only, no spell commit/address |
| vote.sky.money/{executive, executive/create, custom-spell, dashboard, account, /} | 9 | 7 | portal pages only — **no** `/executive/<slug>` or `/polling/<id>` deep links |
| vote.makerdao.com/polling/QmcZNZg3, /executive/create | 2 | 2 | legacy; the polling slug is truncated in source |
| etherscan.io/address, /verifySig/<n>, /verifiedSignatures | 39 | 4 | AD delegate contracts + signed messages, not spells |
| ipfs.io / gateway.pinata.cloud / *.ipfs.w3s.link | 10 | 9 | rate-mechanism doc + Grove legal docs |
| forum.sky.money, forum.makerdao.com, sky-atlas.powerhouse.io | 0 | 0 | absent |

## 6. Dated phrases attached to a vote reference
21 date tokens within 100 chars of a vote word, 14 distinct, **100% `Month d, yyyy`** (a1 list above). Adjacent forms the strict window misses: `Month yyyy` ×7 (a2 MSC months), ISO `yyyy-mm-dd` ×24 (MIP106 + 23 Active Data ledger rows), `(Month d, yyyy)` parenthetical ×1 (dispute decision), forum-slug dates ×3 (`december-11-2025-…`). "Executive Contents - YYYY-MM-DD" (A.1.10.2.4.2.2.2) is the *naming rule* for executive sheets, not an instance. No "by Q3 2025"-style deadline is ever attached to a vote.

## 7. Existing extraction that already touches this
`public/relations.json` and `public/graph.json` are **not built** in this checkout (only `docs.json` exists); not built, per instructions. In `scripts/lib/graph-*.mjs`:
- `graph-transfers.mjs` — `ALLOCATION_VOTE_RE = /included in the ([^.]+?Executive Vote)/i` (Shape D, Genesis/Initial Allocation docs) → `funds_transfer` edge with `kind:"allocation"`, `status:"planned"` and `meta.scheduled = "March 26, 2026 Executive Vote"` (raw string). Grant docs (Shape A) get `status: disbursed|approved`; Grant Authorization docs (Shape C) → `funds_authorization`. This is the only place a specific vote is captured, and only for allocations.
- `graph-transitions.mjs` — Pattern 23 `pending_transition` edges with `EST_DATE_RE` ("estimated … <Month d, yyyy>"); control handoffs, not votes.
- `graph-duties.mjs` — role-duty extraction; ACTIVE/PASSIVE verb lists include `approves|approved`, plus approval-phrase patterns of the "subject to the approval of <role>" family — these bind *roles* (GovOps, Facilitator), never Sky Governance votes.
- `graph-entities.mjs` — Spell Team members (`SPELL_TEAM_UUID` A.1.10.2.2.2.1) as `ecosystem_actor` + `spell_team_member` role.
- `graph-active-data.mjs` — Approved Deviations table (`c304cb9f-…`) parsed as active data rows.
- No edge type for poll/executive/ratification/AEP exists (edgeTypes emitted: has_address, defines_entity, validator_of, signer_of, pending_transition, integration_partner_of, governance_channel, funds_transfer, funds_data_gap, funds_authorization, emergency_response, can_modify_signers_of, aligned_delegate_for, plus role/duty edges). No pattern reads vote.sky.money, forum thread ids, or the AD ledgers' dates.
- Adjacent (non-graph): `src/lib/staleDates.ts` already extracts every dated future-tense claim (day/month/quarter) client-side — the a1 future dates surface there as stale/upcoming; `src/lib/forumKinds.ts` declares `ForumKind = "msc" | "aec" | "spell"` but only the `msc` cycle is registered (no spell/atlas-edit thread series is fetched yet).

## 8. Final regex family (verbatim from scan3.mjs)
```js
const MON = "(?:January|February|March|April|May|June|July|August|September|October|November|December)";
const LD = `${MON} \\d{1,2},? \\d{4}`, MY = `${MON} \\d{4}`, ISO = `\\d{4}-\\d{2}-\\d{2}`;
A: {
  a1_dated_exec_vote:   new RegExp(`\\b(?:${LD}|${MY})[ ,]*(?:Out-Of-Schedule )?Executive Vote\\b`, "g"),
  a2_msc_conducted_in:  new RegExp(`Monthly Settlement Cycle conducted in ${MY}`, "g"),
  a3_mip_dated:         new RegExp(`\\bMIP\\d+\\b[^.]{0,40}(?:${LD}|${ISO})`, "g"),
  a4_vote_portal_url:   /https?:\/\/vote\.(?:sky\.money|makerdao\.com)[^\s\)\]>"*]*/g,
  a5_poll_or_exec_id:   /vote\.(?:sky\.money|makerdao\.com)\/(?:polling|executive)\/(?:Qm[1-9A-HJ-NP-Za-km-z]+|0x[0-9a-fA-F]{40}|\d+)|\bPoll (?:ID|#)\s*\d+/g,
  a6_forum_thread_url:  /https?:\/\/forum\.(?:sky\.money|skyeco\.com|makerdao\.com)\/t\/[^\s\)\]>"]+/g,
  a7_forum_dated_spell_thread: /forum\.skyeco\.com\/t\/[a-z]+-\d{1,2}-\d{4}-proposed-changes-to-[a-z]+-for-upcoming-spell\/\d+/g,
  a8_exec_votes_repo_url: /https?:\/\/github\.com\/(?:sky-ecosystem|makerdao)\/(?:executive-votes|spells-mainnet|Spells-mainnet|pe-checklists)[^\s\)\]>"`]*/g,
  a9_dated_gov_record_row: new RegExp(`^\\|\\s*(?:${ISO}|${LD})\\s*\\|.*forum\\.skyeco\\.com`, "gm"),
  a10_aep_number:       /\bAEP[ -]?#?\s*\d+\b/g,
  a11_dated_governance_decision: new RegExp(`\\b(?:Facilitator Decision|Governance Decision|Dispute[^(]{0,80})\\((?:${LD})\\)`, "g"),
},
B: {
  b1_was_done_in_vote:  /\b(?:was|were|has been|have been|had been) (?:first )?(?:approved|executed|implemented|passed|ratified|enacted|deployed|activated|included|introduced|established|set|created|onboarded|adopted|voted on|authorized)\b[^.]{0,60}?\b(?:in|via|through|by) (?:an?|the) (?:[A-Za-z-]+ )?(?:Executive Vote|Governance Poll|Spell|governance vote)/g,
  b2_already_approved:  /\b(?:already|previously) (?:been )?(?:approved|ratified|authorized|voted on|passed)\b(?: by (?:Sky |Spark |Grove )?[Gg]overnance)?/g,
  b3_hereby_consents:   /\bSky Governance hereby (?:consents|authorizes|approves|ratifies|recognizes|directs)\b/g,
  b4_gov_decision_ratified: /\bgovernance decision(?: that was)? ratified by (?:an?|the) (?:Executive Vote|Governance Poll|governance vote)/g,
  b5_following_ratification: /\bfollowing the ratification of\b/g,
  b6_occurred_in_vote:  /\b(?:occurred|took place|happened) in (?:the|an?) (?:[A-Za-z0-9, -]+ )?(?:Executive Vote|Governance Poll|Spell)\b/g,
  // add for the MCP-found miss: /\b(?:holders|voters|delegates) (?:have |has |had )?voted to (?:approve|reject)\b/g  (1 doc: A.4.1.2.1.1)
},
C: {
  c1_will_be_in_vote:   /\b(?:will|shall|must|should|is to|are to) be (?:included|deployed|executed|implemented|activated|voted on|put|submitted|transferred|made|paid|proposed|set|reduced|increased|updated|enabled|disabled|onboarded|presented|brought)\b[^.]{0,80}?\b(?:in|via|through|to|for|by) (?:an?|the|its own|a future|a subsequent|the next|an upcoming) (?:[A-Za-z0-9, -]+ )?(?:Executive Vote|Governance Poll|Spell|Ratification Poll|governance vote)/g,
  c2_future_exec_vote:  /\b(?:in|via|through|for) (?:a future|an upcoming|a subsequent|the next|a later|a following) (?:[A-Za-z-]+ )?(?:Executive Vote|Governance Poll|Spell|Governance Cycle)\b/g,
  c3_direct_to_exec:    /\bauthorized to proceed directly to an Executive Vote\b/g,
  c4_beginning_with:    new RegExp(`\\b(?:Beginning with|Starting with|As of|Effective|Prior to|Before|After|until|no later than) the (?:${LD}|${MY}) (?:Executive Vote|Governance Poll|Spell)`, "g"),
  c5_subject_to_vote:   /\bsubject to (?:an?|the|prior|further|separate|successful)? ?(?:[A-Za-z-]+ )?(?:vote|poll|Executive Vote|Governance Poll|governance approval|Sky Governance approv\w*|Spark Governance approv\w*|Sky vote|SKY vote|ratification)\b/g,
  c6_pending_approval:  /\b(?:pending|awaiting) (?:[A-Za-z-]+ )?(?:approval|ratification|vote|poll|Executive Vote|Governance Poll)\b/g,
  c7_once_ratified:     /\b(?:once|when|after|upon) (?:[A-Za-z-]+ )?(?:defined and )?(?:ratified|approved|voted on|passed)\b[^.]{0,40}/g,
  c8_future_iteration:  /\bwill be (?:specified|defined|determined|addressed|added) in a (?:future|later|subsequent) iteration of the Atlas\b/g,
},
D: {
  d1_executive_vote: /\bExecutive Votes?\b/g,  d2_governance_poll: /\bGovernance Polls?\b/g,  d3_ratification_poll: /\bRatification Polls?\b/g,
  d4_spell: /\bSpells?\b/g,  d5_aep: /\bAEPs?\b|\bAtlas Edit Proposals?\b/g,  d6_atlas_edit_cycle: /\bAtlas Edit (?:Weekly|Monthly) (?:Governance )?Cycle\b/g,
  d7_gov_cycles: /\b(?:Operational Weekly Cycle|Monthly Governance Cycle|Weekly Cycle|Monthly Cycle|Governance Cycle)\b/g,
  d8_sky_governance: /\bSky Governance\b/g,  d9_out_of_schedule: /\bOut-Of-Schedule\b/gi,  d10_voting_portal: /\b(?:Voting Portal|voting portal|Governance Portal)\b/g,
  d11_requires_vote: /\b(?:requires?|requiring|required|require) (?:an?|the|a prior|a successful|a separate|a new)? ?(?:[A-Za-z-]+ )?(?:Executive Vote|Governance Poll|Governance Polls|Ratification Poll|poll|vote|governance approval|approval (?:from|of|by) (?:Sky|Spark) Governance)\b/g,
  d12_no_vote_needed: /\bwithout (?:a|the|any) (?:prior |separate |new |additional )?(?:Governance Poll|Executive Vote|poll|vote|governance approval)\b|\bno (?:Executive Vote|Governance Poll|poll|vote) is (?:required|needed|necessary)\b/g,
  d13_must_be_approved_via: /\b(?:must|shall|should|needs? to|can only|may only) be (?:approved|ratified|authorized|confirmed|voted on|passed|executed|enacted) (?:through|via|by|in|with|using) (?:an?|the|a prior|a separate|a successful|a subsequent|a formal)? ?(?:[A-Za-z-]+ )?(?:Executive Vote|Governance Poll|Governance Polls|poll|polling|vote|Ratification Poll|Sky Governance|Spark Governance|Spark governance|governance process|governance)\b/g,
  d14_approved_by_gov_normative: /\b(?:approved|ratified|authorized|recognized|onboarded|derecognized|accepted|adopted|passed|enacted|sanctioned|determined) (?:by|through|via) (?:Sky|Spark|Grove|Maker|MakerDAO|Prime Agent|Agent)? ?(?:Governance|governance)(?! (?:Poll|Polls|Cycle|Facilitator|Process|Scope|Point|Portal|Council|Security|Strategy))/g,
  d15_polls_generic: /\bpoll(?:s|ing)?\b/gi,  d16_vote_generic: /\bvot(?:e|es|ed|ing)\b/gi,  d17_root_edit_token_vote: /\b(?:Root Edit Token Holder Vote|Off-Chain Vote|Snapshot)\b/g,
}
```

## 9. Takeaways for an extractor
1. The high-precision signal is tiny and stereotyped: `<Month d, yyyy> [Out-Of-Schedule ]Executive Vote` (17 docs) + `Monthly Settlement Cycle conducted in <Month yyyy>` (5) + `Sky Governance hereby consents` (9) + `authorized to proceed directly to an Executive Vote` (13) + the three dated forum spell threads. Tense of the governing verb (was executed / occurred vs will be included) gives past-vs-future; `staleDates.ts` already does that classification generically.
2. The atlas never carries poll ids, executive slugs, or spell addresses; the only per-event ledgers are the three AD Active Data tables (ISO date + forum post) and the Dispute Resolutions list.
3. `graph-transfers.mjs` already captures the vote string for allocations (`meta.scheduled`); generalising that regex to a doc-level `scheduled_in_vote` annotation would cover 17 of the 60 category-A docs with one pattern.
4. Everything else ("ratified by Sky Governance", the bare Executive-Vote duty family `d11`, "subject to a SKY vote", Root Edit Snapshot polls) is normative — 793 docs of noise floor that a naive vote-word sweep would drown in.
