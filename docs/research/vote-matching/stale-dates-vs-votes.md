# Stale Dates vs the vote record — research note (2026-09-15)

Research only; produced by throwaway session scripts over `public/docs.json` (atlas `d64eca48`) and the vote corpora described in `vote-corpus.md`.

## 0. Corpora and coverage

| corpus | items | window | atlas UUID links |
|---|---|---|---|
| `community/governance/polls/meta/polls.json` (MakerDAO era) | 1,215 polls | 2019-08-05 → 2025-05-12 | 1 |
| `community/governance/votes/*.md` (MakerDAO era execs) | 227 | 2019 → 2025-05-15 | 21 files, 82 distinct UUIDs, **0 resolve** in docs.json |
| `sky-polls/` (sky-ecosystem/polls) | 144 | 2025-05-26 → 2026-09-14 | 117 files, 37 UUIDs, 5 resolve |
| `exec-votes/` (sky-ecosystem/executive-votes) | 31 (index.json lists 31, not 40) | 2025-05-29 → 2026-09-10 | 23 files, 136 UUIDs, 62 resolve |

Two generations of atlas links exist and only one is usable as a key:
- **Powerhouse-era** (execs 2025-05-29 → 2025-10-30, 155 distinct links): `sky-atlas.powerhouse.io/<doc_no>_<title>/<id>|<hash>`. The `<id>` is a Notion-style id (e.g. `1f1f2ff0-8d73-804c-…`), **0/155 resolve** against next-gen-atlas UUIDs; the `doc_no` in the path resolves for only 34/155 (renumbered since).
- **sky-atlas.io era** (execs 2026-03-26 →, and weekly-cycle polls): `sky-atlas.io/#<uuid>`. **63/65 resolve.** Eight executives (2025-11-13, 11-17, 11-27, 12-11, 2026-01-15, 02-12, 02-26, 03-12) carry **no** atlas link at all.
- Corpus quality: 1/31 exec files has frontmatter `date` ≠ filename/title date (`executive-vote-2026-01-29-…` has `date: 2026-01-26`). Filename date is the reliable field.

Coverage gap after the coordinator's update: the corpus now runs to 2026-09-14, so **27 of the 28 future-tense claims are inside the window**; the only uncovered one is the single `upcoming` claim (2026-12-31). All 135 dated mentions (2023-02 → 2029-06) except 3 (2029 vesting end, 2026-12-31 ×2) fall inside 2019-08 → 2026-09-14.

## 1. Stale-dates report as of 2026-09-15 (atlas `d64eca48`, 11,529 docs)

`bun run run-stale.ts` over `buildStaleDatesReport(docs, 2026-09-15)`:

| bucket | count |
|---|---|
| stale | **27** |
| dueSoon | 0 |
| upcoming | 1 |
| totalDateMentions | **135** (in 75 docs; 28 of them future-tense → the 28 claims) |

Years of the 28 claims: 2024 ×1, 2025 ×9, 2026 ×18. Distinct docs: 23 (three docs carry 2–3 claims each).

## 2. What kind of governance action each claim implies

Regex heuristic (`Executive Vote|governance poll|ratif` → a; `transition` flag → c; `take effect|beginning on|commenc|grant|allocation|borrow|penalty` → b; `requir(ed|es) to be|checkpoint|re-approval|term` → d; `was|ending on` → e) gave a/b/c/d/e = 11/11/1/4/1, f=0. Hand reading moved two rows (row 1 and the Sep-10 MSC deadline; see below). **Final distribution (28 claims):**

| class | n | note |
|---|---|---|
| (a) explicit Executive Vote named | 11 | all read "…will be included in / executed in / beginning with the `<Month D, YYYY>` Executive Vote" |
| (b) parameter / grant / accord with an effective date | 10 | enacted by an Atlas edit poll (authorization) and, for transfers, a Prime proxy spell inside an executive |
| (c) transition / handoff | 1 | Spark governance control transfer |
| (d) deadline / checkpoint needing no vote | 5 | delegate term checkpoints, MSC posting deadline |
| (e) descriptive / past tense (detector false positive) | 1 | "ending on May 20 2024" — FUTURE_RE fired on "will be rewarded" 60 chars later |
| (f) other | 0 | |

Verbatim examples (doc_no · uuid):

(a) explicit vote
- A.3.5.2.2.2 · 0803e6b5-5755-431c-9ef0-999115f6f897 — "The activation of the Kicker Module will be executed in the «October 30, 2025» Executive Vote. This action is authorized to proceed directly to an Executive Vote without a pr…"
- A.2.8.2.6.2.2.2.2 · 65638659-eb0d-4e5c-87e8-50705e3595b8 — "…transfer of 10,000,000 USDS from the Surplus Buffer to the Osero SubProxy for the Genesis Capital Allocation will be included in the «March 26, 2026» Executive Vote."
- A.1.10.2.5.1.2.1.1 · badd8b62-dffe-4778-b5e2-78c76195242d — "Beginning with the «June 18, 2026» Executive Vote, a completed Agent Spell Reviewer Checklist must be included in the Spell review…"

(b) parameter / grant with effective date
- A.2.8.2.2.2.2.1 · 552e7b01-c2d0-4658-ac49-2c74e230aeac — "…entitled to borrow up to 1,000,000,000 USDS from Sky at a subsidized rate for an initial period of 2 years, beginning «January 1, 2026»."
- A.2.8.2.2.2.4.5.2.1 · 85f7d545-d56c-40b9-b1b4-05663cd7772a — "cash grant of 800,000 USDS per month to the Grove Foundation from Grove's Prime Treasury for a three (3) month period, beginning on «April 1, 2026»."
- A.2.11.1.3.2 · 6033699f-1d55-45ba-8eb1-bd8982571cc0 — "All requirements in the documents herein shall take effect on «May 20, 2026»."

(c) transition
- A.6.1.1.1.2.2.2.2.1.2.4 · 6ecef2b2-42c7-4bea-80f0-1cb1cd4e735d — "At such time, which is currently estimated for «September 17, 2025», control will transition to Spark Governance."

(d) deadline / checkpoint, no vote
- A.2.4.1.2.1.5.2 · 146d3d9c-7f8a-4dc4-b6b3-349bab4279bb — "The Initial Calculation and the Independent Calculation were required to be posted to the Sky Forum by «September 10, 2025»." (already past tense — "were required" — a second detector false positive via `BY_DATE_RE`)
- A.6.1.1.1.3.1.3.4.3 · c612d4e4-96c4-4ccf-a830-7f742338cfd9 — "there will be no re-approval on «January 1, 2026»; the first re-approval checkpoint is July 1, 2026"
- A.6.1.1.2.3.1.4.4.3 · 2e484aa5-73d1-4773-a97d-cccf9323c576 — "the initial term begins on «August 1, 2026» and runs until December 31, 2026"

(e) descriptive
- A.6.1.1.1.3.2.2.1.1 · 93dddb43-1d2e-4ea8-ab18-eb0518a193ba — "Season 1 of pre-launch token rewards was active from August 20 2023 and lasted for nine months, ending on «May 20 2024»."

Sample of the 107 non-future mentions (what the atlas does with enacted things): 19 are "`<Month D, YYYY>` Executive Vote" references, of which 8 are past-tense records ("was executed in the June 26, 2025 Executive Vote" — A.4.1.2.2.4.2.1 · 1b8248bf; "Stage 1 was first implemented in the September 18, 2025 Executive Vote" — A.2.4.1.2.2.1.2 · ff3aa296); ~30 are Active Data table rows (delegate effective dates, derecognitions, GRF breaches); ~15 are accord commencement dates ("Ecosystem Accord 4 … commencing from November 13, 2025" — A.2.8.2.4.1.2 · 90e40d2a); 7 are DAO Resolutions "On November 20, 2025, a DAO Resolution was passed…" (A.6.1.1.2.3.6.3 · 1890a855).

## 3. Micro-test: matching claims to votes

Three keys, run over all 28 claims (`match.py`):

| method | claims with ≥1 hit | judged correct (top-1) | notes |
|---|---|---|---|
| (i) UUID-or-ancestor link | **2 / 28** (1 direct, 1 via ancestor) | 1 / 2 | direct: 85f7d545 ← exec 2026-06-04 (correct, +64 d). Ancestor: A.2.4.1.2.1.5.2 ← A.2.4 root linked by 5 MSC execs May–Sep 2026 — all wrong (root-level link is too coarse). Over all 75 dated docs: 4 linked directly, 10 via self-or-ancestor. |
| (ii) ±21 d window + TF-IDF over title+summary | 27 / 28 have candidates (6–40 each; median 10) | **8 / 27** top-1; 13 / 27 within top-3 | window density is the problem: every window contains 2–3 weekly Atlas-edit polls whose summaries mention everything, so they dominate low-signal claims |
| (iii) both | 1 / 28 | 1 / 1 | the Grove Q2 grant — and even there the window match is the wrong item (poll 04-06), the UUID link is right |
| exact-date "`<Month D, YYYY>` Executive Vote" | **16 / 19 mentions** (12 distinct dates, 10 resolve) | — | sanity test passed for ff3aa296 → 2025-09-18. Misses: 2025-10-02 (spell shipped 2025-10-06, +4 d) and 2026-01-29 ×2 (exec exists; corpus frontmatter says 01-26) |

Hand judgement of 27 covered claims (top-1 of method ii unless noted; "truth" found by reading the votes):

| # | claim (doc_no · uuid8) | class | top-1 (ii) | verdict | truth / offset |
|---|---|---|---|---|---|
| 1 | A.6.1.1.1.3.2.2.1.1 · 93dddb43, 2024-05-20 | e | exec 2024-05-06 Coinbase Custody | wrong | no vote expected |
| 2–4 | A.2.8.2.2.2.7.1/.4/.5 · 5a62cc3f, f3672ca1, 3ae9fa89, 2025-07-01 | b | poll 2025-07-21 Atlas edit "replaces the date of finalization… with July 1, 2025" | **authoring vote, not enactment** | +20 d; the poll that *wrote* the date |
| 5 | A.2.8.2.1.2.9.3 · a768dda1, 2025-07-14 | b | poll 07-28 Grove/Ethena | wrong (Grove ≠ Spark) | no spell (retroactive accord) |
| 6 | A.2.4.1.2.1.5.2 · 146d3d9c, 2025-09-10 | d | poll 09-08 "Define MSC process" (−2 d) | authoring; #2 = exec 2025-09-18 executed MSC 1 | +8 d |
| 7 | A.6.1.1.1.2.2.2.2.1.2.4 · 6ecef2b2, 2025-09-17 | c | poll 09-08 Spark Morpho vault | wrong | poll 2025-06-23 "Add Timeline For Transition Of Spark Governance" wrote the date; 09-15 Atlas edit "Build Out Spark Governance Processes" (−2 d) not in top-3 — no vote records the handoff itself |
| 8 | A.2.8.2.2.2.4.5.1.1 · 12425328, 2025-10-01 | b | exec 10-16 | wrong | exec **2025-10-06** Spark Proxy Spell "Transfer amount: 1,100,000 USDS" to Spark Foundation (+5 d); authorized by poll 2025-09-29 |
| 9 | same doc, "October 2, 2025 Executive Vote" | a | exec 10-16 | wrong; #2 = 10-06 right | slipped +4 d |
| 10 | A.3.5.2.2.2 · 0803e6b5, 2025-10-30 | a | exec 2025-10-30 Initialize Kicker | **right** | 0 d |
| 11 | A.2.8.2.2.2.2.1 · 552e7b01, 2026-01-01 | b | exec 01-15 | wrong | poll 2025-11-24 "Triggers Subsidized Borrowing… as of January 1, 2026" (−38 d, **outside ±21**); no spell |
| 12 | A.6.1.1.1.3.1.3.4.3 · c612d4e4, 2026-01-01 | d | weekly poll (score 0.03) | noise | no vote expected |
| 13–14 | A.2.8.2.7.2.2.2.1/.2 · 36556509, be600bf6, 2026-01-29 | a | exec 01-29 (Skybase Genesis Capital) | **right** | 0 d (−3 by frontmatter) |
| 15,17,18 | A.2.8.2.3.2.3 · 7df88d38 (Keel), A.2.8.2.8.2.1 · ff5c1b0c (Amatsu), A.2.8.2.9.2.1 · ee64a5b7 (Ozone), 2026-03-26 | a | exec 2026-03-26 Genesis Funding Transfers | **right** | 0 d; authorized by poll 03-16 |
| 16 | A.2.8.2.6.2.2.2.2 · 65638659 (**Osero**), 2026-03-26 | a | same exec, score 0.18 | **false positive** — the exec names Amatsu, Ozone, Keel, Prysm; "Osero" appears nowhere in it, nor in any later genesis transfer | genuinely unfulfilled/overdue claim |
| 19 | A.2.8.2.2.2.4.5.1.2 · bd9673db, Q1 2026 | b | poll 03-23 (Spark Foundation **Q2**) | wrong quarter | Q1 authorization was Dec 2025 (forum link in doc), spell Dec/Jan |
| 20 | A.2.8.2.2.2.4.5.2.1 · 85f7d545, 2026-04-01 | b | poll 04-06 | wrong; UUID link → exec 06-04 right | authorized by poll **2026-04-27** (+26 d, outside window, retroactive); disbursed +64 d |
| 21 | A.4.2.2.3.2 · 1c0d2cf1, 2026-04-09 | a | exec 2026-04-09 Launch Avalanche SkyLink | **right** | 0 d; poll 04-06 added the docs |
| 22 | A.2.11.1.3.2 · 6033699f, 2026-05-20 | b | poll 05-04 | wrong | poll **2026-04-20** "Add Multisig Security Enforcement Framework… effective May 20, 2026" (−30 d, outside window); no spell |
| 23 | A.1.10.2.5.1.2.1.1 · badd8b62, 2026-06-18 | a | exec 06-04 | wrong; #3 = exec 06-18 exists but never mentions the checklist | process rule, not a spell action |
| 24–25 | c612d4e4, 2026-06-30 / 07-01 | d | weekly polls (0.02–0.06) | noise | no vote expected |
| 26 | badd8b62, 2026-07-16 | a | poll 07-06 "Per the July 16 Executive Vote, each Reviewer…" (−10 d) | authoring; #2 exec 07-16 exists, silent on checklist | 0 d |
| 27 | A.6.1.1.2.3.1.4.4.3 · 2e484aa5, 2026-08-01 | b | poll 08-17 (Grove Foundation Aug grant) | wrong | no vote expected |

Precision on the sample: method (ii) top-1 = **8/27 (30%)** strictly right; counting "authoring Atlas-edit poll for this very sentence" as useful evidence, 14/27 (52%). Restricted to class (a) claims, top-1/top-3 = 7/11 and 10/11 — the "`<Month D, YYYY>` Executive Vote" phrasing plus an exact-date key is the one high-precision path. Method (i) = 1/2 right; 0 recall for the powerhouse-era claims.

Failure modes, in order of frequency:
1. **Authoring vs enactment** (7 claims): the best candidate is the weekly Atlas-edit poll that *inserted* the dated sentence (poll 2025-07-21 wrote "July 1, 2025"; poll 2025-11-24 wrote "January 1, 2026"; poll 2026-04-20 wrote "May 20, 2026"). Such a match proves the plan was ratified, not that the dated thing happened.
2. **Weekly-poll noise**: every ±21 d window holds 3 Atlas-edit polls with kitchen-sink summaries; they take top-1 for 11/27 claims. Any window method needs a "kind" filter (executive vs Atlas-edit vs parameter poll) before scoring.
3. **Authorization lands outside ±21 d and often *after* the effective date**: Grove Q2 grant authorized +26 d after "beginning April 1"; Subsidized Borrowing −38 d; Multisig framework −30 d. Effective-date claims (class b) need ±45 d and an asymmetric window.
4. **Effective date ≠ vote date**: class (b) dates are period starts (Q1, "beginning on"), vote dates cluster on Thursdays; matched spells sit +4…+8 d (Oct-2 → Oct-6 slip; Sep-10 deadline → Sep-18 MSC exec).
5. **Right executive, wrong content** (Osero): date-window scoring has no way to see that the named action is absent. Only a subject-noun check inside the executive body catches it — and that is precisely the case a facilitator wants flagged.
6. **Date-only executive matches that carry no evidence** (Reviewer Checklist Jun-18/Jul-16): the exec exists on the day but the claim is a process rule the spell text never mentions.
7. **Corpus data quality**: frontmatter date drift (2026-01-29 file dated 01-26); powerhouse-era links unusable as keys; 8 executives with no atlas link.
8. **Detector false positives feed the matcher**: 2 of 28 "claims" are past tense (rows 1 and 6) — matching them is wasted work and any hit is spurious.

Offset histogram (atlas date → judged-relevant vote date, 23 pairs incl. authoring polls): **0 d: 9** (every class-a Executive Vote claim that shipped on schedule, executives by filename date) · 1–7 d: 4 (+4, +5, −2, −2) · 8–21 d: 6 (+8, −10, +18, +20 ×3) · 22–45 d: 3 (+26, −30, −38) · >45 d: 1 (+64). Executives sit at 0…+8 d; Atlas-edit polls scatter −38…+26 d. Net: class (a) needs exact-date with +7 d slip tolerance; class (b) needs ±45 d and mostly resolves to polls, not executives.

## 4. Reverse micro-test: do the 20 most recent executives show up in the atlas?

20 executives 2025-11-13 → 2026-09-10, 117 `###` action sections.

| signal | result |
|---|---|
| section carries an `sky-atlas.io/#uuid` **Authorization** link | 37/117 (35 resolve). Zero before 2026-03-26; 30–60% of sections after |
| section authorization is a governance poll | 42/117 |
| forum post / none | 38/117 |
| executive's own date (`<Month D, YYYY>`) appears anywhere in atlas prose | **9/20** |
| section title ≥0.6 token-overlap with some atlas doc title | 50/117, but mostly generic hits ("Safe Harbor Update" → A.2.11.1.2; "Monthly Settlement Cycle for X" → A.2.4.1) |

Qualitatively: the atlas records an executive **when the executive was pre-announced in the atlas** (genesis transfers, Kicker, Avalanche, Solana bridge, PAS Timelock → all 9 date hits are those) or when a Prime writes a DAO-resolution log (A.6.1.1.2.3.6.x). Routine spell content — DC-IAM parameters, staking-reward normalization, MSC execution, delayed-upgrade penalty steps, delegate compensation — is **not** recorded as dated events; the atlas holds the *rule* (A.3.7.1.2.2 DC-IAM, A.4.4.1.2 rewards, A.2.4 MSC) and the executive links back to that rule. 11 of 20 executives leave no dated trace at all (2026-01-15, 02-12, 02-26, 03-12, 04-23, 05-07, 06-04, 07-02, 08-13, 09-10, and 01-29 by frontmatter). Conclusion: the atlas is mostly plans plus a thin, selective enacted-log; the vote record is the only complete source of enactment, and from 2026-03 its UUID links make the executive→atlas direction traversable (rule-level, not claim-level).

## 5. Recommendation: a "vote evidence" column (plan only)

Attach to each `DateClaim` a `voteEvidence` with one of four states, computed from a vote index (polls + executives, keyed by date, kind, linked UUIDs, and section titles) that would be synced like `settlements.json` — off the build chain, never fatal:

| state | rule |
|---|---|
| `enacted` | an **executive** exists within the class-specific window **and** its body/title contains the claim's subject nouns (agent name, contract, foundation), or a section links the claim doc UUID or its parent (max 2 levels up — root-level links like A.2.4 are excluded). Class (a) window: exact date, tolerance +7 d (slips). Class (b): −45…+70 d, and count Atlas-edit polls as `authorized`, not `enacted`. |
| `authorized-only` | only an Atlas-edit poll matches (the sentence was ratified; nothing executed) — show the poll date and label it as such |
| `no-vote-in-window` | corpus covers the date, nothing matches → the actionable stale signal |
| `corpus-not-covering` | claim date > last corpus date, or < 2025-05-26 for UUID keys (powerhouse-era) |
| `n/a` | class (d)/(e) claims — deadlines, checkpoints, past tense — labelled so nobody expects a vote |

Implementation notes for the plan (repo untouched):
- Classify before matching: the class comes from the same context window the report already extracts; a `voteClass` field next to `transition` would let the UI hide `n/a` rows from the vote column.
- Keying priority: (1) exact "`<Month D, YYYY>` Executive Vote" → executive by filename date (16/19 today); (2) claim-doc or parent UUID in a section Authorization link; (3) subject-noun containment in executive bodies within the window; (4) TF-IDF only as a tiebreaker, never alone.
- Use filename dates for executives (frontmatter drifted once in 31); treat `oos-` files as executives.
- Surface the offset (`voteDate − claimDate`) so a facilitator can see "+4 d slip" vs "+64 d retroactive".

False-positive risks:
- **Date-coincidence with a rich executive** (Osero/Mar-26): an exec on the right day that omits the action. Mitigate with the subject-noun check; Osero is the regression case.
- **Authoring poll mistaken for enactment** (7/27 here): the poll that inserted the sentence always sits within a few weeks of the date. It gets its own state.
- **Ancestor links at Scope/Article level** (A.2.4 ← 5 MSC execs): cap ancestor depth or require the link to be the claim doc's parent, not any ancestor.
- **Generic section titles** ("Safe Harbor Update", "Prime Agent Proxy Spells") overlap dozens of atlas titles — never match on title overlap alone.
- **Detector false positives** (past-tense "ending on", and the "were required to be posted … by September 10, 2025" row at A.2.4.1.2.1.5.2 · `146d3d9c`) flow through and would get spurious `enacted`/`no-vote` labels; fixing `FUTURE_RE`/`BY_DATE_RE` for past-tense guards precedes the column.
- **Powerhouse-era claims (2025-05 → 2025-10)** have no usable UUID key; they fall back to keys (1)/(3) and are labelled lower-confidence.
- **Corpus staleness**: a lagging clone turns every recent claim into `no-vote-in-window`; the state degrades to `corpus-not-covering` from the corpus's last date, not from today.
