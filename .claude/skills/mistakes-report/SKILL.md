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
  version: "1.0"
---

# mistakes-report

`public/potential-mistakes.json` holds the suspected defects in the Atlas source text — typos, wrong words, broken cross-references, wrong figures, contradictions. It is **committed data, not a build artifact**: the sweep is LLM judgement, hand-run, and deliberately does **not** re-run on an atlas bump. That is what the report's provenance banner promises readers, so keep it true.

This skill is the runbook for refreshing it. The sweep is **incremental**: only documents whose title, type, or body changed since the last run are re-read.

## Entry points

- **`pnpm mistakes:status`** — read-only. How much has drifted since the last sweep. Safe anywhere, writes nothing.
- **`pnpm mistakes:plan [--full] [--limit=N] [--max-bytes=N]`** — computes the work plan, writes `.cache/mistakes-sweep/chunks/NNN.md` (the documents to read) and `plan.json`. `--full` re-queues the whole corpus; `--limit` caps a sitting and leaves the rest queued for next time.
- **`pnpm mistakes:merge [--dry-run]`** — folds agent output back into the artifact and advances the sweep state.
- **`pnpm mistakes:bootstrap`** — one-off, already done. Adopts an existing whole-corpus sweep as the incremental baseline.
- **`pnpm mistakes:render`** — regenerates the gitignored `ATLAS-FINDINGS.md` export from the JSON.

## Files

| Path | Role |
|---|---|
| `public/potential-mistakes.json` | The artifact. Single source of truth, committed, backs the live report. |
| `.github/mistakes-sweep-state.json` | Per-document digests of what was last evaluated. Committed — without it every run is a full sweep. |
| `.cache/mistakes-sweep/` | Scratch for one run: `plan.json`, `chunks/`, `findings/`. Gitignored, rebuilt by every `plan`. |
| `scripts/lib/mistakes-sweep.mjs` | The pure logic (digest, plan, validate, merge). Tested by `scripts_tests/mistakes-sweep.test.ts`. |

## The cycle

### 1. Plan

```bash
pnpm mistakes:status     # is there anything to do?
pnpm mistakes:plan
```

Read `.cache/mistakes-sweep/plan.json`. If `queued` is 0, stop — nothing changed, and there is nothing honest to add to the report.

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
- **`category`** — one of: `numeric`, `entity`, `governance`, `contradiction`, `structural`, `xref`, `stale`, `placeholder`, `copy-paste`, `wrong-word`, `typo`, `grammar`, `markdown`, `naming`, `duplication`. Adding a category means adding a label to `scripts/aux/render-potential-mistakes.mjs` and the report's filter pills too.
- **`id`, `docNo`, `file`** are stamped by `merge` from the live atlas — agents do not supply them.

## Rules that keep the sweep honest

**Write the output file even when a chunk yields nothing.** An empty `findings/NNN.jsonl` means "read it, found nothing" and retires those documents until they next change. A *missing* file means "never processed" and keeps them queued. A killed agent's silence is otherwise indistinguishable from a clean bill of health — this is the failure that quarantined several partial runs during the original sweep.

**Never hand-edit the state file to mark documents scanned.** It is the record of what was actually read.

**A re-evaluated document's old findings are dropped.** That is the point: a defect fixed upstream disappears instead of lingering. It also means a lazy re-read silently deletes real findings, so agents get the whole document, not a diff of it.

**`merge` will not advance a chunk whose JSONL is malformed.** A truncated last line means the agent died mid-write; the chunk stays queued rather than being half-trusted.

## Known limitation

Incremental evaluation is per-document. A **corpus-wide** finding — a cross-reference from a document that did not change to one that did — will not be revisited by a `changed`-only run. Periodically (an atlas restructuring, a large upstream merge) run `pnpm mistakes:plan --full` to re-derive those. Say so plainly rather than implying every run re-checks everything.

## Finishing

The report is user-visible, so a refresh that changes what readers see needs:

- a one-line `patch-notes.md` bullet, dated the day it merges (skip it if you are extending an unreleased change from the same PR);
- `.github/mistakes-sweep-state.json` and `public/potential-mistakes.json` committed **together** — a state file ahead of the artifact retires documents whose findings never landed.
