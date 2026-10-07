# Vote evidence: second-voice eval — handoff

**The question.** Stale Dates' vote evidence (`src/lib/votes/`) is heuristic: a date key, a
capitalised-name check, and uuid links. Would Jev (TypeSafe System One) or an LLM, asked as a second
voice, judge these claims better? This eval answers that on hand-checked gold. Run it locally with
your OpenRouter key. The model arms were not run in the building session (its key had no credits).

## What is measured

**Task 1 · subject.** An atlas sentence credits an action to a dated Executive Vote, and the
matcher chose an executive for it. The question: does that executive carry out what the sentence
says? Each arm answers `yes`, `no`, `anchor` (the sentence only uses the vote as a date), or
abstains. There are two slices:
- **real**: the 38 sentences in the atlas today, matched to their executive.
- **swapped**: each confirmed sentence paired with an executive 45 or more days away whose text
  lacks the gold evidence line. Gold is "no" by construction. This measures false yeses, which the
  real slice does not measure, because it has no real negatives (see Osero below).

**Task 2 · poll.** A dated claim that names no Executive Vote. Which passed governance poll
authorised it, if any? There are 18 claims: 14 have an authorising poll, and 4 need none.
Candidates are the passed polls from 120 days before to 60 days after the claim, ranked lexically
and cut to the top 8. The models choose among those 8.

| Arm | What it is | Runs when |
|---|---|---|
| `heuristic` | the shipped matcher (`src/lib/votes/evidence.ts`) | always |
| `lexical` | TF-IDF top-1 among the candidates (the plan's K5) | poll task, always |
| `history` | `git log -S` on the claim's words, then the commit's pull request number, then the poll linking that pull request (the plan's K3, no model) | poll task, when the atlas submodule has full history |
| decision models (`jev-1.13`, …) | Typed Nouls from a `/systemone` decision model. Subject task: `anchor` and `carried` over the sentence plus the executive's sections. Poll task: one Noul per candidate | `OPENROUTER_API_KEY` set; models from `--decision-models a,b` (default `CHAT_JEV_MODEL`) |
| `llm` | one JSON answer per case, same state as Jev | `--llm-model <openrouter id>` |

## Run it

```bash
pnpm build:index                 # public/docs.json at the checked-out atlas
pnpm votes:sync                  # public/votes.json WITH section text (older files are refused)
git -C vendor/next-gen-atlas fetch --unshallow   # only if the submodule is shallow; the history arm needs it

pnpm eval:vote-evidence                              # heuristic + lexical + history, plus Jev if the key is set
pnpm eval:vote-evidence --llm-model <openrouter-id>  # add an LLM arm (rerun with another id to compare; answers are cached per model)
pnpm eval:vote-evidence --task subject --tau 0.6     # one task; a different Jev yes-threshold
pnpm eval:vote-evidence --poll-dir ../polls          # a local sky-ecosystem/polls clone instead of the tarball
```

- **Cost and caching.** Every model answer is cached in `.cache/eval-vote-evidence/{jev,llm}/`,
  keyed on the model and the exact request. A rerun costs nothing, and the threshold sweeps are
  computed from stored answers. A 401, 402 or 403 stops the run.
- **Volume.** Each model arm makes about 90 requests: 38 real + 34 swapped subject cases, plus
  18 poll cases. Subject requests carry one executive (typically 5–15 KB). Poll requests carry up
  to 8 poll bodies (about 3–6 KB each).
- **Where spend shows up.** Scripts in `scripts/eval/` are attributed to "Sky Atlas Redline Evals"
  in OpenRouter.
- **Results.** Full rows are written to `.cache/eval-vote-evidence.json`. The printed report has
  one table per task and slice, the Jev threshold sweeps, and every disagreement with gold.

## Baseline, measured without models (atlas `33fd2631`, vote record of 2026-10-07)

```
subject · real (39 labeled)          accuracy  coverage  caught-no  false-alarms
  heuristic                            97%       87%       0/0        1        ← the 1 is Osero
subject · swapped (34 labeled)
  heuristic                            59%       85%      17/34       0
poll (18 labeled; prefilter kept a gold poll in 12/14 top-K, 13/14 in window)
                                     accuracy  found   false-matches
  heuristic                            22%      0/14      0/4
  lexical                              33%      5/14      3/4
  history                             100%     14/14      0/4
```

(The real slice has 39 rows from 38 gold labels: one document states the same date in two
sentences.)

## First run: Jev (`typesafe/jev-1.13`), 2026-10-07

| Task | Jev at τ 0.5 | Best threshold |
|---|---|---|
| Subject, real (39) | 20 right. 5/5 anchors; 19 confirmed claims answered "no" | — |
| Subject, swapped (34) | **34/34 caught**, against the heuristic's 17/34 | every swapped `carried` is ≤ 0.33 |
| Poll (18) | 5/14 found, 0/4 false | Its top-ranked candidate is the gold poll in 11 of the 12 cases where gold is among the candidates. Every no-vote claim scores ≤ 0.08, so τ 0.15 gives 10/14 found, 0/4 false |

**Reading the subject result.** Jev's "yes" is precise: no swapped executive scored above 0.33.
Its "no" is not reliable, but most of its 19 false "no"s were caused by the harness, not by Jev:
- **9 grant payments were cut off.** They sit deep inside Prime proxy-spell sections, which the
  first harness truncated at 3,000 characters per section. Jev never saw those lines.
- **2 are renamed agents.** Osero scored 0.04 and Obex 0.31. The plain-text step dropped link
  URLs, so the address that ties old name to new never reached Jev.
- **The rest are borderline**, between 0.35 and 0.49.

**Fixed for the second run:**
- **No more per-section cut.** Whole executives are under 20 KB, so sections go in whole.
- **Addresses kept.** `plainText` (`scripts/lib/votes/markdown.ts`) keeps any on-chain address a
  link URL carries, e.g. "Launch Agent 6 SubProxy (0x24fd…)".
- **More context.** Both judges also get the claim's own atlas document text, and the question
  allows a party under an earlier name when an address or alias ties them.
- **Wider sweeps.** The threshold sweeps now start at 0.1.

To rerun, re-sync first, because the section text changed:

```bash
pnpm votes:sync && pnpm eval:vote-evidence      # subject requests are new (re-paid); poll answers come from the cache
```

What to look for: whether the 9 truncated grants and Osero now read "yes", and whether the swapped
slice stays at 34/34.

## Second run: Jev (`typesafe/jev-1.13`) with whole executives, 2026-10-07

| Task | heuristic | Jev at τ 0.5 | Jev, best threshold |
|---|---|---|---|
| Subject, real (39) | 97% of the 87% it answers, 1 false alarm (Osero) | **95% at 100% coverage**, Osero right | — |
| Subject, swapped (34) | 17/34 caught | **33/34 caught** | 97% over both slices at τ 0.3–0.4 |
| Poll (18) | 0/14 found | 5/14 found, 0/4 false | 78% at τ 0.1–0.15 (10/14 found, 0/4 false) |
| Poll, history arm | — | — | 14/14, 0/4 false |

**Jev's remaining subject misses.**
- **Real slice, two false "no"s.**
  - Stage 1 of the Monthly Settlement Cycle (A.2.4.1.2.2.1.2 · `ff3aa296`). The executive runs the
    first settlement and cites the Stage 1 document as its authority, but never names "Stage 1".
  - The Gnosis payment (A.4.1.1.1.1.1 · `418d496b`).
- **Swapped slice, one false "yes":** the Grove Foundation grant (A.2.8.2.2.2.4.5.2.3.1 ·
  `b5ab118c`). The swapped executive pays a Grove Foundation grant for a different month, so gold's
  "no" there is the noisy kind the caveats describe.

**What this says.**
- **Subject task.** A decision model is worth building as the second voice. It catches the wrong-vote
  case the heuristic lets through (33 against 17 of 34), and it follows the renamed agent the
  heuristic flags. A threshold near 0.35 is the measured best.
- **Poll task.** The history key stays first: free, deterministic, 14/14. A decision model at
  τ 0.15 is the fallback for claims history does not reach.

## Trying another decision model

Any model OpenRouter serves on its `/systemone` decisions endpoint takes the same typed questions.
`openai/gpt-6-luna-decisions` is one; it has no chat-completions API, so it does not fit the
`--llm-model` arm. Run several side by side:

```bash
pnpm eval:vote-evidence --decision-models typesafe/jev-1.13,openai/gpt-6-luna-decisions
```

Each model gets its own column, its own threshold sweeps, and its own name in the disagreement
list. Answers are cached per model, so Jev's answers replay and only the new model is paid.

## Third run: Jev against `openai/gpt-6-luna-decisions`, 2026-10-07

| Task | jev-1.13 | gpt-6-luna-decisions |
|---|---|---|
| Subject, real (39) at τ 0.5 | 95%, 2 false alarms | 62%, 15 false alarms |
| Subject, swapped (34) at τ 0.5 | 33/34 | 33/34 (plus one swapped case answered "anchor") |
| Subject, best threshold (both slices) | 97% at τ 0.3–0.4 | 87% at τ 0.1 |
| Poll at τ 0.5 | 5/14 found, 0/4 false | 2/14 found, 0/4 false |
| Poll, best threshold | 78% at τ 0.1–0.15 | 50% at τ ≤ 0.2 |

**Where Luna fails.** Its subject misses are the hard cases: grants inside proxy-spell sections, the
renamed agents (Osero, Obex), and the two Solana bridge phases. These are the ones Jev missed only
while executives were truncated. Luna now sees the whole executive and still says no, and its
probabilities run low (best threshold 0.1).

**Luna adds nothing beside Jev:** it matches Jev on the swapped slice and is worse everywhere else,
so an ensemble gains nothing.

**Caveat:** the questions were written with Jev in mind. Luna may want different phrasing, but this
run gives no reason to pursue it.

**Decision:** Jev is the decision model for both tasks.

## Fourth run: Jev against `cloudflare/clef`, 2026-10-07

| Task | jev-1.13 | clef |
|---|---|---|
| Subject, real (39) at τ 0.5 | 95%, 2 false alarms | **97%, 1 false alarm** (Osero and the Gnosis payment right) |
| Subject, swapped (34) at τ 0.5 | **33/34** | 29/34 |
| Subject, best threshold (both slices) | **97% at τ 0.3–0.4** | 93% at τ 0.6 |
| Poll at τ 0.5 | 5/14 found, 0/4 false | **8/14 found**, 0/4 false |
| Poll, best threshold | **78% at τ 0.1–0.15** | 72% at τ ≤ 0.4 |

**Clef's swapped misses.**
- **Two are real errors:** it credited the Keel and Osero genesis transfers to the January 29
  executive, which funds Skybase.
- **Two are the debatable monthly-grant kind:** a Spark grant and a Grove grant paid in another
  month.
- **One is shared with Jev:** the Grove grant swap.

**Calibration.** Clef's probabilities sit higher, so it is the better model at an untuned 0.5. Jev
needs its thresholds tuned (about 0.35 for subject, 0.15 for polls) and is better once they are.

**Combining them does not help.** Requiring both to say yes, or accepting either, does not beat
Jev alone on these rows.

**At this sample size the gaps are noise.** Differences of one to three cases between the two are
within it. Clef is the credible runner-up, and the fallback if Jev's price or availability changes.

**Decision unchanged:** Jev, with tuned thresholds.

## Osero was enacted: the research's headline case is a false alarm

The gold labelling found that the March 26, 2026 executive does carry the Osero genesis transfer.
- The atlas document (A.2.8.2.6.2.2.2.2 · `65638659`) gives Osero's SubProxy as `0x24fdcd3b…78D3`.
- The executive transfers "10 million USDS to the Launch Agent 6 SubProxy" at that address.
- The executive of 2026-02-26 onboarded that address as Launch Agent 6 (`PRYSM_SUBPROXY`).
- Executives from 2026-07-16 call it `OSERO_SUBPROXY`.

The shipped matcher still flags it `subject-missing`, because names alone do not follow a rename.
The plan (§10) and the research note carry the correction. Two consequences:
- **For this eval:** a judge that reads addresses and section context could get Osero right. Watch
  that row.
- **For the product:** the Stale Dates page currently shows a false "subject missing" on Osero.
  Fixing it means recognising renamed agents (aliases, or addresses through linked documents). That
  decision is separate from this eval.

## How to decide

**Subject task.** A second voice earns its place if it does all of the following:
- catches clearly more of the swapped slice than the heuristic's **17/34**;
- adds no false alarms on the real slice;
- gets Osero right (`yes`).

If it only matches the heuristic, keep the heuristic: it is free and explainable. A good outcome
suggests the cached second-opinion design: precompute per changed claim, show disagreements, and
label the model's view as AI-judged.

**Poll task.** The deterministic `history` arm sets a high bar (14/14, 0/4 false). A model is worth
adding only if:
- it is close to that bar, and
- it reaches claims history misses: claims whose words were written in a commit without a pull
  request number, or in a Prime-side edit no Sky poll links.

Whatever the models score, the cheapest win this eval points to is building K3 from `atlas_history`
(it already stores each commit's pull request number) to replace "no linked vote".

## Caveats

- **Small n.** There are 38 sentences and 18 claims. Treat differences of one or two cases as
  noise.
- **How the gold was made.** Two Claude agents labelled it by reading the executive sections and
  poll bodies, and every row carries a verbatim `evidence` quote so you can audit it. Three poll
  labels and the Osero label were re-checked by hand. Spot-check more before acting on a close
  result.
- **The history arm is partly circular.** The poll labeller found polls by the same commit → pull
  request → poll route, then confirmed each by reading the poll's bullet.
- **Swapped noise.** Monthly grants (Spark and Grove Foundation) recur. A swapped executive can
  carry the same grant for a different month, and a judge may reasonably call that "yes". Read the
  swapped disagreements before counting them against an arm.
- **The prefilter caps the model arms on the poll task:** 12 of 14 gold polls reach the top 8.
  `--k` widens it, at more tokens per request.
- **The atlas moves.** New claims print as "cases without gold". Label them in
  `scripts/eval/eval-corpora/vote-evidence-gold.json` with the same fields and an evidence quote.
  Gold rows whose sentence the atlas rewrote print as stale.

## Files

| Path | Role |
|---|---|
| `scripts/eval/eval-vote-evidence.ts` | entry: flags, model calls, cache, output |
| `scripts/eval/eval-vote-evidence-cases.ts` | builds the cases from docs.json, votes.json and poll bodies; joins gold |
| `scripts/eval/eval-vote-evidence-judges.ts` | the Jev questions, the LLM prompts, answer parsing |
| `scripts/eval/eval-vote-evidence-lexical.ts` | the TF-IDF prefilter and lexical arm |
| `scripts/eval/eval-vote-evidence-history.ts` | the history (K3) arm |
| `scripts/eval/eval-vote-evidence-score.ts` / `-report.ts` | labels, scores, printing |
| `scripts/eval/eval-corpora/vote-evidence-gold.json` | the gold, with evidence quotes |
| `scripts/eval/eval-vote-evidence.test.ts` | unit tests for the pure parts |

**What to send back:** the printed report and `.cache/eval-vote-evidence.json`.
