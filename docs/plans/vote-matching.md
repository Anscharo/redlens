# Matching atlas vote references to vote.sky.money — plan + micro-tests

*Status: PLAN ONLY (2026-09-15; revised the same day after the sky.money domains were
whitelisted — see §2b). Nothing is built. Three research notes carry the evidence:
`docs/research/vote-matching/atlas-vote-references.md` (what the atlas says about votes),
`docs/research/vote-matching/vote-corpus.md` (polls vs executives, API shape, the link census),
`docs/research/vote-matching/stale-dates-vs-votes.md` (the Stale Dates cross-check). Numbers
below are as of atlas `d64eca48`, executive-votes `2026-09-10`, polls `2026-09-14`.*

## 0. The question

The atlas asserts things like *"Stage 1 was first implemented in the September 18, 2025
Executive Vote"* (A.2.4.1.2.2.1.2 · `ff3aa296-34eb-4783-904f-4510fa0c6c37`) and *"will be included
in the March 26, 2026 Executive Vote"* (A.2.8.2.6.2.2.2.2 · `65638659-…`). vote.sky.money is the
record of what was actually voted. We want to (1) find every such reference, (2) know the vote
record, (3) join them, and (4) stop reading an atlas date as proof a vote happened.

## 1. Polls vs executives (what we are matching against)

| | Governance poll | Executive vote |
|---|---|---|
| Object | Off-chain **signal**: a markdown file whose IPFS multihash is registered on the polling contract (`PollCreated`) | On-chain **spell contract** (`address:` in frontmatter) that changes the protocol |
| Who / weight | SKY locked in the chief, snapshotted at poll end | Same locked SKY, continuous approval (`chief.approvals(spell)`) |
| Outcome | Off-chain `victory_conditions` (plurality / majority / IRV / approval / comparison, e.g. the weekly-cycle "≥ 480M SKY" floor) | Whichever spell holds the most approvals is the **hat**; then `schedule()` → GSM pause delay (48h) → `cast()`; 30-day expiry; optional office hours |
| Cadence | Mon 16:00 UTC, 3 days (143/144 current polls) | Bi-weekly Thursdays (29/30) plus out-of-schedule |
| Identity | `pollId` (uint), `multiHash`, `slug = multiHash[:8]`, portal URL `/polling/<slug>` | spell `address`, `key = slugify(title)`, portal URL `/executive/<key>` |
| Lifecycle | passes → bundled as one `### <action>` section of the next executive, cited as `**Authorization**: [Governance poll N](…/polling/<slug>)` | hat → scheduled → cast; `spellData.{datePassed, dateExecuted, hasBeenCast}` |

An atlas date can refer to any of: poll start, executive **proposal** date (the date in the
title/filename), pass date, cast date (+2…+8d), or an *effective* date written into the rule. Only
the executive proposal date is what atlas prose actually uses ("the September 18, 2025 Executive
Vote" is the executive *dated* 2025-09-18).

## 2. Data sources (what this environment can and cannot reach)

- **The portal API is reachable** (the sky.money domains were whitelisted for this work on
  2026-09-15; the earlier draft of this plan recorded them as blocked, and `vote-corpus.md` §2
  still describes the shapes as reconstructed from portal source — they are now confirmed live).
  What it adds beyond the git corpora is in §2b.
- **Reachable, and sufficient for matching**: plain git.
  - `https://github.com/sky-ecosystem/executive-votes` — 31 executives 2025-05-29 → 2026-09-10
    (`<yyyy>/executive-vote-<yyyy-mm-dd>-<slug>.md`, frontmatter `title/summary/date/address`,
    `index.json`, `active/proposals.json`). **Use the filename date**: 1/31 has a drifted
    frontmatter `date`.
  - `https://github.com/sky-ecosystem/polls` — 144 polls 2025-05-26 → 2026-09-14
    (`<yyyy>/<yyyy-mm-dd>-<slug>.md`, frontmatter incl. `start_date/end_date/discussion_link/
    parameters`, `index.json`, `meta/tags.json`, `meta/poll-tags.json` keyed by pollId 1504–1649).
    The markdown carries **no pollId / multihash**; that join needs the API or chain logs
    (`PollCreated` on `0xD3A9FE…`, already enumerated once by
    `scripts/aux/atlas-history/enumerate-onchain-polls.mjs` for the severed era).
  - `https://github.com/makerdao/community` (`governance/polls/meta/polls.json` 1,215 polls with
    pollId/slug/multihash, `governance/votes/*.md` 227 executives) — the 2019 → May 2025 archive.
- **Atlas side, already in the repo**: `public/docs.json`, `atlas_history` rows (`commit_sha`,
  `committed_at`, `pr_number`, `pr_title` per doc change), the atlas submodule's git log.

### 2b. What the portal API adds (verified live, 2026-09-15)

| Endpoint | Returns | Why it matters here |
|---|---|---|
| `/api/polling/all-polls-with-tally?pageSize=30&page=N` | 144 polls, 5 pages (`pageSize` caps at 30) | Supplies the `pollId` / `multiHash` / `slug` the poll markdown lacks, **and a `url` pointing at the file in `sky-ecosystem/polls`** — the file↔pollId join `vote-corpus.md` §3 recorded as missing. 129 of 144 `url`s resolve to that repo. |
| same, `tally` block | `winner`, `winningOptionName`, `numVoters`, participation | Poll **outcome**: 143 Yes, **1 No** (Grove Liquidity Layer, 2025-07-28). Near-constant, but the single failure is precisely the case where an atlas claim resting on a poll would be wrong. |
| `/api/executive?start&limit` | 31 executives, 2025-05-29 → 2026-09-10 (Sky era only) | `spellData.datePassed` and `dateExecuted` per spell. All 31 were cast. |
| `/api/executive/hat` | current hat + `skyOnHat` | Live support threshold. |

This upgrades K1's evidence from *an executive file exists on that date* to *the spell passed on
X and executed on Y*. Typical shape: proposal date → passed +1 to +3d → executed +2 to +4d.

**Three dates per executive, and they disagree.** The 2026-01-29 file
`executive-vote-2026-01-29-msc-pattern-and-skybase-onboarding.md` carries frontmatter `date:
2026-01-26`, the API reports the same 2026-01-26, and the spell actually passed 2026-01-30 — one
spell (`0x4d99868F…`), three dates. The atlas cites "the January 29, 2026 Executive Vote", i.e.
the **filename** date. Keying K1 on the API date alone loses this executive and both Skybase
claims that name it (`36556509`, `be600bf6`). So K1 resolves in order: filename date → API `date`
→ `datePassed` within +4d.

## 3. What the atlas says (census, 11,529 docs)

| Class | Docs | Signal |
|---|---|---|
| **A** explicit, specific vote or governance action | **60** | 17 docs with `<Month D, YYYY> Executive Vote` (19 hits, 14 distinct dates); 5 "Monthly Settlement Cycle conducted in <Month YYYY>"; 8 vote-portal URLs (portal pages only, no deep links); 11 docs with forum thread URLs (3 are dated "proposed changes … for upcoming spell" threads); 2 Active Data ledgers with 23 dated rows; 1 legacy poll id (`vote.makerdao.com/polling/QmcZNZg3`) |
| **B** a vote happened, no specifics | **16** | "Sky Governance hereby consents/authorizes …" in 9 Grant Authorization docs; "already approved by governance" ×4 |
| **C** forward-looking commitment | **78** (≈35 genuine) | 13 docs say an action is "authorized to proceed directly to an Executive Vote" (e.g. A.2.8.2.4.2.1.2.1 · `c39702fb`); 20 schedule an action into a named Executive Vote (e.g. A.2.8.2.3.2.3 · `7df88d38`); 11 point at a "next/future/upcoming" one (e.g. A.4.2.2.4.2 · `44af823e`); 39 defer to "a future iteration of the Atlas" (e.g. A.2.4.1.2.2.1.4) |
| **D** mechanism / normative noise floor | **875** | "Spell" in 345 docs (863 hits inside A.1.10), "Executive Vote" 240, "Governance Poll" 78, "Sky Governance" 157 |

Facts that shape the design:
- The high-precision signal is small and stereotyped: dated Executive Vote + MSC-month + "hereby
  consents" + "proceed directly to an Executive Vote" + the 3 dated spell threads ≈ 45 docs.
- The atlas **never** carries poll ids, executive slugs or spell addresses. Dates are always
  `Month D, YYYY` when next to a vote noun; the date always precedes the noun.
- A naive vote-word sweep hits 928 docs (8% of the atlas); 793 are pure mechanism prose.
- Existing extraction captures exactly one form: `ALLOCATION_VOTE_RE` in
  `scripts/lib/graph-transfers.mjs` (`funds_transfer` edge with `meta.scheduled="March 26, 2026
  Executive Vote"` as a raw string). No poll/executive/ratification edge type exists.

## 4. Matching axes — five keys, ranked by measured precision

Each axis was micro-tested on real data. Precision figures come from hand judgement in the
research notes; none of this is implemented.

### K1 · Exact executive date (atlas prose → executive)  — **highest precision**
Pattern `<Month D, YYYY>[ Out-Of-Schedule] Executive Vote` → executive file whose **filename** date
equals it (tolerate +7d: one spell slipped 10-02 → 10-06). Tested: **16/19 mentions resolve** to an
existing executive by exact date (the 3 misses are the +4d slip and a frontmatter drift). The
sentence's tense says whether the atlas records enactment ("was executed in") or a plan ("will be
included in"). Generalising `ALLOCATION_VOTE_RE` to a doc-level annotation covers 17/60 class-A
docs with one regex. Covers class A/C(a).

### K2 · Atlas UUID links inside votes (vote → atlas doc) — **high precision, growing coverage**
Executives cite the atlas per action: every one of the 188 `### <action>` sections in the 31
current executives has an `**Authorization**:` line; 94 cite an atlas doc, 57 cite a governance
poll, 30 a forum thread. Two link generations exist and only one is usable:
- `https://sky-atlas.io/#<uuid>` (from 2025-11; all executives from 2026-03-26): **63/65 uuids
  resolve** in our checkout. Also `https://sky-atlas.io/#A.1.10.2.2` doc_no-only fragments (298
  links, renumbering-fragile — resolve at ingest time against that build's `doc_no` and store the
  uuid).
- `https://sky-atlas.powerhouse.io/<doc_no>_<title>/<id>|<hash>` (2024-09 → 2026-03, 1,376 links):
  the `<id>` is a Powerhouse/Notion id, **0/135 resolve** against next-gen-atlas uuids; the
  `doc_no` in the path resolves for only 34/155 (renumbered since). Recoverable only through the
  HTML-era history identity map (`scripts/lib/history-identity.mjs`) — a separate project.
Caveat from the test: ancestor walks must stop before Scope/Article roots — a link to A.2.4 (the
MSC Article) matched 5 unrelated MSC executives. Max 2 levels up, never a Scope root.
Covers: executive ↔ rule-level doc, weekly Atlas Edit poll ↔ the doc it links (A.1.11.2 ×16).

### K3 · Atlas history ↔ Atlas Edit poll (which poll ratified this text) — **deterministic**
Every atlas commit since mid-2025 is one PR titled `Atlas Edit Proposal — <yyyy-mm-dd> (#N)`, and
the date is the weekly poll's start date. Tested: **23/23 such commits match a
`<date>-Atlas-edit-weekly-cycle-proposal.md` file** (one date has two polls, so key on date +
`weekly` tag, not date alone). Since `atlas_history` already stores `commit_sha` / `pr_number` /
`pr_title` per doc change, every history row can carry "ratified by poll <slug>" with no fuzzy
matching. Other commit subjects name executives ("2026-09-10 Spell Parameter Updates",
"Aug 13 Spell Update", "updates for 2025-06-26 spell") → K1 on the subject.
This is the axis that answers "*was the sentence itself voted on?*" — distinct from "*did the vote
the sentence names happen?*".

### K4 · Subject-noun containment inside the executive body — **the disambiguator**
For a class-A/C claim with a K1 date hit, check the executive's Proposal Details for the
claim's subject nouns (agent name, module name, amount). Tested regression case: the Osero genesis
transfer (`65638659`) names the March 26, 2026 executive; that executive exists and scores 0.18 by
text similarity, but names Amatsu, Ozone, Keel, Prysm — **Osero appears literally zero times**.
Date-only matching marks it matched; it is in fact unfulfilled. K4 is what turns "an executive
happened that day" into "this claim was enacted".

**Weight the nouns, or K4 passes the one claim we know is false.** Running the end-to-end test
below with a plain "half the subject words appear" rule, the Osero claim *passes* — on the token
`USDS`, which appears in **31 of 31** executives and therefore carries no evidence at all. The
same goes for `Bridge`, `Spell`, `Agent`. K4 scores by inverse document frequency across the
executive corpus (or restricts to entity nouns from the graph's entity list), and counts a
match only when at least one *discriminating* token is present. A claim whose only matches are corpus-wide tokens is
`date-hit-no-subject`, not `enacted`.

**End-to-end result (K1 → K4, live API, all 19 dated claims):** 17 of 19 resolve to an executive
(the 2 misses are both the January date drift above, recovered by the filename rule); every one of
those 17 spells passed and executed. Subject confirmed in the body for 15 of 19 — but that 15
includes the Osero false positive under the unweighted rule, which is what motivates the IDF
weighting above. Two rows land at PARTIAL and are correct to flag: `ff3aa296` (Stage 1, whose subject
words are calendar months) and `badd8b62` (the Spell Reviewer Checklist, genuinely absent from the
June 18 executive).

### K5 · Date window + text similarity (fallback) — **low precision, keep as tiebreaker only**
±21d window over polls+executives, TF-IDF over title+summary against the claim context. Tested on
the 27 stale claims: **8/27 right at top-1**, 13/27 in top-3. Failure modes, in order: the weekly
Atlas Edit poll that *authored* the sentence outranks the enacting vote (7/27); kitchen-sink
weekly-poll summaries win top-1 (11/27); authorising polls sit outside ±21d and often *after* the
effective date (+26, −30, −38d); spells cast +4…+8d after the named date. Offset histogram of the
23 judged-relevant pairs: 0d ×9, 1–7d ×4, 8–21d ×6, 22–45d ×3, >45d ×1. So: executives need an
exact date with +7d slip; effective-date claims need −45…+70d and mostly resolve to polls.

### Recommended combination
```
K1 exact date  ──► K4 subject check ──► enacted / date-hit-but-no-subject (⚠)
K2 uuid link   ──► (self or ≤2 ancestors, never Scope) ──► authorised-by / enacted-by
K3 history     ──► ratified-by poll  (always available, answers a different question)
K5             ──► only to rank candidates the above already admitted
```

## 5. Stale Dates: a date in the atlas is not evidence of a vote

Stale Dates today (`src/lib/staleDates.ts`, 2026-09-15): **27 stale, 0 due soon, 1 upcoming**, out
of 135 dated mentions in 75 docs. Hand classification of the 28 future-tense claims:

| Class | n | Vote expected? |
|---|---|---|
| (a) names an Executive Vote by date | 11 | yes — K1+K4 |
| (b) parameter / grant / accord with an effective date | 10 | usually a weekly Atlas Edit poll authorises; a Prime proxy spell may enact; window −45…+70d |
| (c) control transition / handoff | 1 | no vote records handoffs |
| (d) deadline or checkpoint needing no vote | 5 | no |
| (e) past tense, detector false positive | 1 | no (fix `FUTURE_RE`/`BY_DATE_RE` first) |

Three findings that justify the user's premise:
1. **The atlas is written before the vote, and its tense is not maintained afterwards.** See §5b.
2. **The record is thin in the enacted direction.** Of the 20 most recent executives, only 9 leave
   any dated trace in atlas prose, all of them pre-announced items (genesis transfers, Kicker,
   Avalanche, Solana bridge, PAS Timelock). Routine spell content (DC-IAM, staking rewards, MSC
   execution, delegate compensation) is recorded as rules, never as dated events.
3. **A vote on the day is not the vote.** Osero (above); the Agent Spell Reviewer Checklist
   (`badd8b62`, "beginning with the June 18, 2026 Executive Vote") — executives exist on 06-18 and
   07-16 but neither mentions the checklist.

Proposed (not built) `voteEvidence` on `DateClaim`, computed like `transition` is today:
`enacted` (K1+K4, or K2 on self/parent) · `authorised-only` (only an Atlas Edit poll matches) ·
`date-hit-no-subject` (an executive exists on the date but K4 fails — the Osero class, surfaced as
a warning, not a match) · `no-vote-in-window` (the actionable signal) · `corpus-not-covering`
(claim date after the vote index's last date — degrade from the *index's* last date, never from
today) · `n/a` (classes d/e). Show the day offset. Add a `voteClass` next to `transition` first,
since the window and the expected source differ per class.

## 5b. Measured: tense is editorial, not evidence

All 19 dated `<Month D, YYYY> Executive Vote` sentences in the current atlas were traced through
the atlas submodule's full git history (254 commits, root 2025-05-28 through 2026-09-14), matching
each sentence across rewordings and the three storage layouts by its capitalised subject words.
The raw table is `docs/research/vote-matching/retensing-measurement.txt`. Every one of the 19
dates is now in the past.

| Measure | Result |
|---|---|
| Sentences whose date has passed | 19 |
| …still written in the future tense ("will be included in the March 26, 2026 Executive Vote") | **13** |
| …written in the past tense | 5 (1 mixed) |
| Dates with a matching executive file in `sky-ecosystem/executive-votes` | **17 of 19** |
| Rewritten in place from future to past | **2** |
| Born in the past tense (written after the fact) | 3 |
| Authored before the vote / same week / after it | 8 / 6 / 5 |

Retensing, where it happens at all, is slow and inconsistent:

- A.4.1.2.2.4.2.1 · `1b8248bf` — "The disabling of the Legacy Conversion Contract **will be**
  executed in the June 26, 2025 Executive Vote" was authored 14 days *before* that vote and
  rewritten to "**was** executed" on 2026-01-19, **207 days after** it.
- A.4.1.2.1.1.1.1 · `ec820ddb` — present at the repo's root commit (2025-05-28, still the HTML-era
  `Sky Atlas.html`) reading, at A.4.1.2.1.1.1.1, "the Delayed Upgrade Penalty … **must be set** to 1%" in the September 18,
  2025 Executive Vote, i.e. **113 days ahead** of it; rewritten to "**was set** to 1%" on
  2025-11-07, 50 days after.
- A.2.4.1.2.2.1.2 · `ff3aa296` (the document the request links) — "Stage 1 **was** first
  implemented in the September 18, 2025 Executive Vote" was not written until 2026-09-10, **357
  days after** the vote it describes. It was never a plan; it is a retrospective note.
- A.3.5.2.2.2 · `0803e6b5` — "The activation of the Kicker Module **will be** executed in the
  October 30, 2025 Executive Vote", authored the day after that executive and never retensed,
  although the executive dated 2025-10-30 exists and does contain the Kicker activation.

**This inverts the naive reading of Stale Dates.** A stale claim is future-tense with a passed
date, and 13 of 19 dated vote claims are exactly that — yet 17 of the 19 dates have a real
executive behind them. So the report is, for this class, mostly measuring *editorial lag in the
atlas*, not *governance that failed to happen*. Only the vote record separates the two, which is
the whole argument for building the join.

The corollary matters more: **the genuinely broken claim is textually identical to the healthy
ones.** A.2.8.2.6.2.2.2.2 · `65638659` says the Osero Genesis Capital Allocation "will be included
in the March 26, 2026 Executive Vote" — but it was authored on **2026-05-21, 56 days after** that
executive, which names Amatsu, Ozone, Keel and Prysm and never mentions Osero. Its three sibling
transfers (`7df88d38`, `ff5c1b0c`, `ee64a5b7`) were authored 6 days *before* the vote and are
confirmed in it. Nothing in the sentence distinguishes them; only opening the executive does.
Authoring lag from `atlas_history` is therefore a cheap prior worth carrying alongside K4: a claim
authored *after* the vote it names has either been back-dated or missed its slot.

## 6. Ingestion sketch (for when this is built)

- Off the `pnpm build` chain, like `settlements.json`: a `votes:sync` script shallow-clones the two
  sky-ecosystem repos (plus the makerdao archive once, for pre-2025 keys) and writes
  `public/votes.json`: `{executives:[{date, key, address, title, summary, sections:[{heading,
  authorization:{kind: atlas|poll|forum|other, atlas_uuid?, poll_slug?, url}, proposal_url}]}],
  polls:[{start, end, slug?, pollId?, title, summary, tags[], discussion_link, atlas_uuids[]}]}`.
  Resolve doc_no-only fragments to uuids at sync time against that build's docs.json.
- Layer the portal API (`/api/executive`, `/api/polling/all-polls-with-tally`) for
  `pollId`/`slug`/tallies/`spellData` — reachable today (§2b), so the sync writes enactment dates,
  not just file existence. Keep the chain as the offline fallback for poll ids and spell status (`PollCreated` logs, `spell.done()`,
  `chief.approvals`), read with the viem multicall pattern in
  `scripts/required/snap-chainstate.mjs`.
- Carry the authoring lag: `atlas_history` already stores `committed_at` per doc change, so the
  "authored after the vote it names" check (§5b) needs no new data, only the first-seen commit.
- Graph: one new edge type (`scheduled_in_vote` / `enacted_in_vote`, source doc → vote id, with
  `status: planned|enacted|unfulfilled` and the K-axis that produced it) rather than a raw string
  in `meta.scheduled`. History rows gain `ratified_by_poll` from K3.
- Reader: on a doc with vote evidence, show the vote (K2/K3) the way `NodeMeta` already shows the
  `sky-atlas.io/#uuid` deep link; on the Stale Dates report, the `voteEvidence` column.

## 7. Open questions / risks

- Powerhouse-era links (2025-05 → 2026-03, incl. 8 executives with no atlas link at all) are a
  dead key until the HTML-era identity map covers them. Accept a coverage floor of 2026-03-26 for
  K2 and say so in the UI.
- Prime proposals (Spark/Grove/Keel polls, ~90 of 144 polls) enact through Prime proxy spells
  inside an executive's "Prime Agent Proxy Spells" section, so K4 looks inside sub-bullets rather
  than section headings.
- The weekly poll's "summary" is a kitchen-sink list, so a text-similarity axis down-weights polls
  tagged `weekly`; otherwise they win every comparison.
- `pnpm check:atlas`-style tripwire: if the executive-votes repo changes its filename convention
  the K1/K3 keys silently go dark — assert a floor count and the date-in-filename invariant at
  sync time, and throw.
