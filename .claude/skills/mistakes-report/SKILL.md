---
name: mistakes-report
description: >
  Runbook for refreshing the Potential Mistakes report — the LLM defect sweep
  behind public/potential-mistakes.json and /reports/potential-mistakes.
  Triggered by phrases like "re-run the mistakes sweep", "update the potential
  mistakes report", "refresh atlas findings", "sweep the atlas for mistakes",
  "mistakes:plan", or any work on scripts/aux/mistakes-sweep.mjs. Covers the
  incremental plan/merge cycle, the subagent fan-out and model split, the JSONL
  finding contract, and the rules that stop a killed agent from silently
  retiring documents.
license: MIT
metadata:
  author: anscharo
  version: "1.1"
---

# mistakes-report

`public/potential-mistakes.json` holds the suspected defects in the Atlas source text — typos, wrong words, broken cross-references, wrong figures, contradictions. It is **committed data, not a build artifact**: the sweep is LLM judgement, hand-run, and deliberately does **not** re-run on an atlas bump. That is what the report's provenance banner promises readers, so keep it true.

This skill is the runbook for refreshing it. The sweep is **incremental**: a run re-reads the documents whose title, type, or body changed since the last one — plus, via the atlas link graph, the unchanged documents that cross-reference them.

## Entry points

- **`pnpm mistakes:status`** — read-only. How much has drifted since the last sweep. Safe anywhere, writes nothing.
- **`pnpm mistakes:plan [--full] [--limit=N] [--max-bytes=N] [--no-backlinks]`** — computes the work plan, writes `.cache/mistakes-sweep/chunks/NNN.md` (the documents to read) and `plan.json`. `--full` re-queues the whole corpus; `--limit` caps a sitting and leaves the rest queued for next time; `--no-backlinks` skips the cross-reference expansion below.
- **`pnpm mistakes:merge [--dry-run] [--drop-corpus]`** — folds agent output back into the artifact and advances the sweep state. `--drop-corpus` also retires the hand-maintained corpus-wide rows (see below).
- **`pnpm mistakes:bootstrap`** — one-off, already done. Adopts an existing whole-corpus sweep as the incremental baseline.
- **`pnpm mistakes:render`** — regenerates the gitignored `ATLAS-FINDINGS.md` export from the JSON.

## Files

| Path | Role |
|---|---|
| `public/potential-mistakes.json` | The artifact. Single source of truth, committed, backs the live report. `findings` is what users see; `rejected` is the human veto list (see below). |
| `.github/mistakes-sweep-state.json` | Per-document digests of what was last evaluated. Committed — without it every run is a full sweep. |
| `.cache/mistakes-sweep/` | Scratch for one run: `plan.json`, `chunks/`, `findings/`. Gitignored, rebuilt by every `plan`. |
| `scripts/lib/mistakes-sweep.mjs` | The pure logic (digest, plan, validate, merge). Tested by `scripts_tests/mistakes-sweep.test.ts`. |
| `scripts/lib/mistakes-corpus.mjs` | Corpus-wide detectors — the cross-document comparisons the chunked fan-out cannot see. Tested by `scripts_tests/mistakes-corpus.test.ts`. |

## The cycle

### 1. Plan

```bash
pnpm mistakes:status     # is there anything to do?
pnpm mistakes:plan
```

Read `.cache/mistakes-sweep/plan.json`. `counts` breaks the corpus into `new` / `changed` / `linked` / `unchanged` / `removed`, and `linkedBecause` maps each re-queued citer to what it points at. If `queued` is 0, stop — nothing changed, and there is nothing honest to add to the report.

### 2. Fan out

One subagent per chunk file, **at most 16 concurrent**. Each agent reads exactly one `chunks/NNN.md` and writes exactly one `findings/NNN.jsonl`.

Run two passes over the same chunks, because they catch different things and a single prompt does both badly:

| Pass | Model | Looks for |
|---|---|---|
| `language` | `sonnet` | Typos, grammar, wrong words (*proscribed*/*prescribed*), copy-paste residue, broken markdown, naming inconsistency. |
| `factual` | `opus` | Arithmetic and thresholds, contradictions between documents, wrong entities or addresses, stale dates, broken cross-references, unfilled placeholders. |

Keep agent prompts **tiny**: write the instructions once to a scratchpad file and have each agent read it, then return only a count. Findings go to disk, never through the agent's reply — that is what keeps a 11k-document sweep affordable.

### 3. Merge

```bash
pnpm mistakes:merge --dry-run    # read the counts first
pnpm mistakes:merge
```

Then regenerate and re-gate the markdown export:

```bash
pnpm mistakes:render
pnpm cite:check ATLAS-FINDINGS.md
```

## The finding contract

One JSON object per line in `findings/NNN.jsonl`:

```json
{"uuid":"88df9622-…","category":"wrong-word","severity":"high","pass":"language",
 "quote":"at the proscribed conversion rate","issue":"\"Proscribed\" (forbidden) where \"prescribed\" is intended.","fix":"at the prescribed conversion rate"}
```

- **`uuid`** — the document's UUID from the chunk header. Never a doc_no: doc numbers are editorial labels that change on renumbering, UUIDs are the stable identity, and the report re-resolves the current doc_no live.
- **`quote`** — **verbatim** atlas text, copied not paraphrased. `merge` rejects any finding whose quote is not a literal substring of the document; that check is the only thing standing between a hallucinated quote and the committed artifact.
- **`severity`** — `high` / `medium` / `low`. This is **confidence that it is a real defect**, not how damaging it would be.
- **`pass`** — `language`, `factual`, or `deterministic`.
- **`category`** — one of: `numeric`, `entity`, `governance`, `contradiction`, `structural`, `xref`, `stale`, `placeholder`, `copy-paste`, `wrong-word`, `typo`, `grammar`, `markdown`, `naming`, `duplication`. **`merge` rejects anything else**: an unknown category renders a filter pill the report cannot decode back out of the URL, so the pill silently does nothing. Adding one means editing `CATEGORIES` (`scripts/lib/mistakes-sweep.mjs`), `CATEGORY_LABELS` (`src/lib/potentialMistakesIndex.ts` — a test pins the two together) and `scripts/aux/render-potential-mistakes.mjs`.
- **`id`, `docNo`, `file`** are stamped by `merge` from the live atlas — agents do not supply them. `file` comes from a layout-blind scan of the source tree, not the loader, for the same reason `check:atlas` does its own recount.

## Rules that keep the sweep honest

**Write the output file even when a chunk yields nothing.** An empty `findings/NNN.jsonl` means "read it, found nothing" and retires those documents until they next change. A *missing* file means "never processed" and keeps them queued. A killed agent's silence is otherwise indistinguishable from a clean bill of health — this is the failure that quarantined several partial runs during the original sweep.

**Never hand-edit the state file to mark documents scanned.** It is the record of what was actually read.

**A finding a human ruled out belongs in `rejected`, not deleted.** The artifact carries a `rejected` list beside `findings`: same row shape plus `rejectedReason`, `rejectedOn` and `rejectedIn` (the review that argued it). The report reads `findings` only, so a rejected row is invisible to users, and `suppressRejected` drops any incoming finding repeating a rejected `(uuid, category, quote)` — so re-sweeping that document cannot put it back. Deleting the row instead would mean re-applying the veto by hand after every sweep. The key includes the quote on purpose: **if upstream rewrites the passage the veto lapses**, because nobody has judged the new wording. Rejecting findings is a human call — record it in a `docs/reviews/` note and point `rejectedIn` at it.

**A re-evaluated document's old findings are dropped.** That is the point: a defect fixed upstream disappears instead of lingering. It also means a lazy re-read silently deletes real findings, so agents get the whole document, not a diff of it.

**`merge` will not advance a chunk whose JSONL is malformed.** A truncated last line means the agent died mid-write; the chunk stays queued rather than being half-trusted.

**Corpus-wide findings come from detectors, not from the fan-out.** A row with `uuid: null` is a defect that spans documents and belongs to none — "six prime artifacts say *circulating* where two say *total*", `docNo` a wildcard (`A.6.1.1.*.…`). No chunk contains such a finding, so no agent can report one. `scripts/lib/mistakes-corpus.mjs` produces them deterministically instead, and **`pnpm mistakes:merge` runs the detectors whenever the plan was `--full`**, retiring and rebuilding every row they own.

What a corpus row may have done to it depends on whether something can rebuild it:

| Row | On `--full` |
|---|---|
| carries a `detector` that just ran | retired and re-derived from scratch |
| carries no `detector` (hand-authored) | kept — nothing can rebuild it. `--drop-corpus` is the deliberate purge |

That is what makes `--full` mean *re-derive everything* rather than *re-read every document and hope*. Detector output is a candidate list like any other pass: expect false positives where artifacts legitimately differ (each Prime names its own executor agent, its own multisig), and veto those into `rejected` — `suppressRejected` keeps them out of every later run.

**A finding that names one document belongs to that document.** Seven rows once carried `uuid: null` while naming a single doc — they showed as `corpus` in the report, could never be re-evaluated, and never drifted. They were backfilled by resolving each verbatim quote against the atlas (2026-09-16). If a sweep ever emits a document-anchored row without a UUID again, resolve it rather than leaving it corpus-wide: only a finding with no single home belongs in that bucket.

## Cross-reference expansion

A document can be broken by a document other than itself: it cites a title that was renamed, restates a figure that moved, or links to a document that was deleted. Its own text never changed, so a per-document diff skips it.

The planner closes that with the atlas link graph. `buildBacklinks()` inverts the same UUID markdown links `build-graph` emits as the `cites` edge, and any unchanged document that points at something `new`, `changed` or `removed` is re-queued in its own **`linked`** bucket. Its chunk entry carries a `Re-queued: cross-references …` line naming the target and what happened to it — an agent handed only the citing text cannot tell a stale reference from a fine one.

Two things to know:

- **One hop.** A re-queued citer is not itself "changed", so nothing expands from it. Without that, a one-word fix walks outward until it has re-read the corpus. The cost is real but small: the live atlas has ~2,200 cross-references over 11.5k documents, mean fan-in 1.7 and max 24.
- **The index is derived, not loaded.** `public/relations.json` is built ephemerally and never committed, so a planner that read it would queue different documents on a fresh checkout. One deliberate difference from the `cites` edge: a link into a document the atlas no longer has is *kept*, because that dangling reference is the whole point.

`--no-backlinks` turns the expansion off. `--full` still exists for the case the expansion genuinely cannot see: a pure renumbering leaves every digest unchanged (`doc_no` is excluded by design), so nothing is `changed` and nothing expands — yet every link label that embeds a doc_no is now suspect.

## Finishing

Commit `.github/mistakes-sweep-state.json` and `public/potential-mistakes.json` **together** — a state file ahead of the artifact retires documents whose findings never landed.

A refresh needs **no `patch-notes.md` bullet**. Re-running the sweep is routine data maintenance, not a shipped capability: the report already exists and already says when it was last swept. Add a note only if the refresh changes what the report *is* — a new category, a new filter, a change to how findings are presented.
