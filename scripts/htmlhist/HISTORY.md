# Atlas history scripts — what they are, when to run them

There are **two separate history pipelines**. Don't mix them up.

## A. Live history (production — runs itself)

| Command | Does | When |
| --- | --- | --- |
| `pnpm build:history` | git log of the atlas submodule → Postgres `atlas_history` (or `--out-json` → `public/history/<uuid>.json`) | Automatic, every atlas-worker cycle. You rarely run it by hand. Covers the post-#117 (atomized markdown) era. |

That's the whole modern story. Everything below is the **pre-#117 (HTML-era) reconstruction** — offline, `ancient-history` branch only, run deliberately.

## B. HTML-era reconstruction (`htmlhist:*`)

Lifecycle order. `prepare` produces a baseline artifact; `curate` decides the ambiguous threading; `apply` bakes those decisions back in; `audit` double-checks **every** applied decision with an independent second model (then a reviewer adjudicates the disagreements); `trace`/`audit:accuracy` give extra confidence cross-checks.

Curation is **complete** — `public/history-decisions.json` covers every case, closed out and independently re-checked twice (see the PR #128 description). The interactive `/reports/history-curate` review UI + its dev-only save/propose endpoints existed only to get there and have been retired. What's below is now purely the offline pipeline, kept for reproducibility and for the rare future case (a matcher/threading bug fix, new pre-#117 evidence) that requires re-deciding a case by hand-editing the committed decisions file directly.

| Command | Does | Reads → Writes |
| --- | --- | --- |
| `pnpm htmlhist:prepare` | Build the frozen pre-#117 history artifact (no curation). Deliberate, reviewed reruns only. | 79 HTML commits + #117 seed → `public/history-html-era.json` |
| `pnpm htmlhist:curate` | **Build the decision queue AND auto-resolve it** in one shot — forward∩reverse + reverse∩containment (free, deterministic) + LLM∩matcher (≥90%). Add `--frontier` to escalate the uncertain residual to a frontier model (locks on an independent 2nd signal, else writes a hint). | git history → `public/history-curation.json` (queue) + `public/history-auto-decisions.json` (auto baseline) + `public/history-curation-proposals.json` (frontier hints, with `--frontier`) + `public/history-curation-llm-cache.json` (resume cache) |
| `pnpm htmlhist:resume` | **Continue the frontier in batches** — reuses the existing queue + the resume cache (every prior LLM/frontier ask), so a capped run never re-spends; the `--frontier-limit` is spent only on NOT-yet-asked cases. Run repeatedly to finish the frontier a chunk at a time. | existing queue + cache → grows `history-auto-decisions.json` + `-proposals.json` + the cache |
| `pnpm htmlhist:structural` | **Structural threading pass** — recover the seam lineage of degenerate template leaves by ORDER rather than content (see "Structural threading" below). Emits forced-only decisions; `--measure` reports without writing, `--merge` folds them into the committed decisions file. | committed decisions + the seam → `public/history-structural-decisions.json` (or merges into `public/history-decisions.json`) |
| `pnpm htmlhist:apply [decisions.json]` | Bake the human/auto decisions into the frozen artifact. No arg ⇒ applies the committed `public/history-decisions.json`. **Partial-safe**: undecided cases fall back to the automatic threading. | decisions → re-freezes `public/history-html-era.json` |
| `pnpm htmlhist:audit` | **Pass 1 of the post-curation audit** — independently re-pick the predecessor for **every applied decision** (deterministic, AI, and human) with a cheap second model (`google/gemma-4-31b-it`) and flag every case where it disagrees with the recorded pick. Resumable (caches each ask) + partial-safe (`--limit N`). Then **pass 2** = a reviewer (Claude/human) adjudicates each flagged disagreement and records why. Review report only — never artifact data. | `public/history-decisions.json` + queue → `.cache/audit-html-disagreements.{json,md}` + `.cache/audit-html-decisions.json` (ledger) |
| `pnpm htmlhist:audit:accuracy` | Measure threading **accuracy** (stratified-samples + LLM-grades → a single headline %). The older statistical audit; complements the per-decision one above. Review report only. | → `.cache/audit-html-report.json` |
| `pnpm htmlhist:trace` | Independent forward pass vs the reverse threading — agreement / conflicts cross-check. Review report only. | → `.cache/forward-reverse-diff.json` |
| `bun scripts/htmlhist/check-cross-agent.mjs` | **Cross-agent claim guard** — verifies no seed decision threads a subject in one agent's section to another agent's occurrence (the rotation-error class the 2026-07-03 audit found in 50 decisions). Exits 1 on findings; expect 0. Run after any curation round. | decisions + queue → stdout |
| `bun scripts/htmlhist/render-decisions.mjs` | **Readable render of the decisions file** — joins `history-decisions.json` against the queue: per-commit groups, titles + agent sections, method, recorded `why` evidence. `--why-only` for just the evidence-trailed subset. | decisions + queue → `.cache/decisions-review.md` |
| `bun scripts/htmlhist/export-decisions-judge.mjs` | **Judge-ready JSONL export** — one self-contained record per decision: the decision, FULL content of both sides (newer subject + chosen older), and the top-scored alternatives it was chosen against. Built for pointing an AI at the corpus to second-guess our calls. Flags: `--sha`, `--why-only`, `--sample N`. | decisions + queue → `.cache/decisions-judge.jsonl` |

### Typical pass

```bash
pnpm htmlhist:curate --frontier      # build queue + auto-resolve + frontier-advise the residual
#  → decide any residual cases by hand-editing public/history-decisions.json, then:
git commit public/history-decisions.json
pnpm htmlhist:apply                  # applies the committed decisions → re-freezes the artifact
git commit public/history-html-era.json
pnpm htmlhist:audit                  # pass 1: cheap second model re-checks EVERY decision → flags disagreements
#  → review .cache/audit-html-disagreements.md; pass 2: a reviewer (Claude/human) adjudicates each
#  (pnpm htmlhist:trace / htmlhist:audit:accuracy any time you want an extra confidence cross-check)
```

Partial is fine: decide a subset, apply, commit — undecided cases keep the automatic
threading and you can come back later. Both the curation inputs and the applied output are
committed, so the reconstruction reproduces from git on any checkout.

### Incremental, resumable, deployable in chunks

The whole pipeline is additive — you can do a few commits' worth, deploy, see them on Railway, and
continue, **without ever redoing work**:

```bash
pnpm htmlhist:curate --frontier --frontier-limit 100   # first batch (caches every LLM/frontier ask)
pnpm htmlhist:apply public/history-auto-decisions.json # bake the auto-resolved-so-far (partial-safe)
git add public/history-*.json && git commit && git push # deploy → Railway build:history syncs it
#  … see the new pre-#117 history on Railway …
pnpm htmlhist:resume --frontier-limit 100              # next 100 — cache skips the first 100 (no re-spend)
pnpm htmlhist:apply public/history-auto-decisions.json  # re-bake (now covers 200)
git add public/history-*.json && git commit && git push # deploy again
#  … repeat until the frontier report shows 0 "still uncached" …
```

Why it's safe to stop/resume anywhere:
- **Resume cache** (`history-curation-llm-cache.json`, committed): every LLM/frontier ask is keyed by the
  content-addressed `caseKey`, so a re-run reuses them and spends the `--frontier-limit` only on new cases.
  Errors aren't cached, so they're retried next run. A `--frontier-model` change re-asks just that pass.
- **Apply is partial-safe**: undecided cases fall back to the deterministic thread, so a half-curated
  artifact is still complete + deployable; later batches refine it.
- **Sync is idempotent**: `build:history` upserts the frozen artifact on every deploy, so redeploying with
  a more-complete artifact just updates the rows. `--no-cache` forces a full re-ask (e.g. after a model swap).

The human-in-the-loop path is the same shape: curate a few commits on the page → ⤒ save → `pnpm htmlhist:apply`
(uses the committed `history-decisions.json`) → commit + deploy → continue. Auto and human decisions compose.

### Useful flags on `htmlhist:curate`

- `--no-llm` — skip the LLM pass; just build the queue + the free forward∩reverse auto-resolve (fast, no API spend).
- `--limit N` / `--concurrency N` / `--threshold X` — cap/parallelize/tune the LLM cross-check.
- `--stats` — print queue counts only, write nothing.

To **re-run the auto-resolution over an existing queue** without rebuilding the 6 MB queue (e.g. after changing `--threshold`), call the standalone tool directly: `bun scripts/htmlhist/auto-curate-html-history.mjs`.

### Re-introductions (`history-reintroductions.json`)

Some #117 docs REVIVE a name the live HTML had **already retired** — a migration regression, not new
content. Example: "Launch Agent 2" was renamed to **"Keel"** in the HTML at **PR #66** (`955f3f4d`,
2025-10-09); the #117 migration (`22cc27b5`) reintroduced "Launch Agent 2" on two docs anyway (inconsistently — 210 other mentions stayed "Keel"); **PR #172** (`00cf8b8f`, "Jan 26 Edit") renamed them
back to Keel. Because the true predecessor lives under the *new* name and is degenerate among
identical-body siblings (Spark / Grove / Keel all score 83% — name-only diff), the seed can't thread
them and they'd ship as a bare `seam:"created"` ("introduced here"), losing the real lineage.

`public/history-reintroductions.json` (committed, hand-authored via git-history forensics) records these:
`{ uuid, revivedName, canonicalName, predecessorKey, renamedAwayAt, reintroducedAt, refixedAt, evidence }`.
`prepare-html-history.mjs` reads it and re-tags each listed uuid **`seam:"reintroduced"`** with a
`reintroducedFrom` backlink (canonical name + true predecessor occurrence + the retirement/revival/re-fix
commits) in `docMeta` — so the reconstruction records "revived, not born" and points back to where the
name was retired. Additive (only listed uuids); deterministic; runs on every `prepare`. To add a case:
find the rename with `git log -S'<name>' -- 'Sky Atlas/*'`, confirm the pre-rename name is absent from the
last HTML, append an entry, re-run `pnpm htmlhist:prepare`. (Surfacing the `reintroduced` seam in the FE
history view is a follow-up — like `created`, it currently lives in `docMeta` only, not the event stream.)

### Structural threading (`pnpm htmlhist:structural`)

The same degenerate-sibling failure as re-introductions above, but at scale and without a rename to
trace. The atlas is full of **template leaves**: `Global Activation Status` is one word of prose
(`Completed`), repeated once per primitive per agent — 94 rows in the last HTML, 140 docs today.
`Network`, `Token`, `Target Protocol`, `Triggers`, `Instance Identifiers` are the same shape. Every
seam signal we had is a CONTENT comparison (reverse shingle matcher, forward tracer, ordered
containment) or reads a doc's immediate neighbourhood (positional), so on these they are all flat:
the seed claims a handful of copies and the rest ship `seam:"created"` — "born at #117" — when the
HTML plainly carried them. That is why e.g. Grove's Agent Creation Primitive activation status had
no pre-#117 history at all.

What content can't see is **order**, and order here is exact rather than heuristic. The HTML Agent
Scope Database is a flat ordered `<table>` — no depth markup, no doc_no, hierarchy encoded purely by
row position — and the #117 markdown is the same documents in the same order. So docs the seed
already threaded are **anchors**, and a doc strictly between two anchors on one side must correspond
to a doc strictly between the same two anchors on the other.

`scripts/htmlhist/history-anchored-align.mjs` (pure, unit-tested) reports only assignments those
bounds **force**, and abstains everywhere else:

- **`gap-exact`** — the unclaimed runs between two adjacent anchors are equal-length and their
  title+type line up pairwise. Order alone forces the whole run.
- **`gap-unique`** — otherwise, a title+type occurring exactly once on each side within the bounds
  has only one possible counterpart.
- **abstain** — anything else: unequal runs with repeated titles (`unforced`), or a region where one
  member is already claimed from outside the bounds (`partially-claimed`, i.e. a genuine move).
  Anchors that cross in order are dropped before gaps are cut, so a moved doc never bounds one.

It never ranks or scores, never overrides an existing decision (the committed decisions are its
*input*, so curated picks become anchors), and `--merge` skips any subject already decided. Measured
on the current seam: **823 of 1,203** unthreaded docs forced (813 `gap-exact` + 10 `gap-unique`),
across 155 distinct titles, 98 gaps abstained; 661 of the 823 also have byte-identical content, which
is corroboration the rules never asked for.

### Notes

- The pipeline artifacts (`history-curation.json`, `history-auto-decisions.json`, `history-curation-proposals.json`, `history-decisions.json`, `history-structural-decisions.json`, `history-reintroductions.json`, `history-html-era.json`) are **committed** (the reviewed, reproducible reconstruction). The audit + trace write only to `.cache/`. None are on the `pnpm build` path, so frontend-build determinism is untouched.
- **Serving:** `pnpm build:history` upserts the committed `history-html-era.json` into Postgres `atlas_history` (idempotent, via `htmlEraRows`) on every sync, so dev (preflight) and Railway (atlas worker) both serve the applied reconstruction. No separate sync step.
- **Stale rows after a re-freeze:** that sync is upsert-only — unlike the pre-era artifact, the html-era path has no `supersedes` list, so it never deletes. When a re-freeze moves a row from a synthetic tombstone uuid to a real one (which is exactly what `htmlhist:structural` does, ~800 times), the old synthetic-uuid rows stay behind. They're unreachable — no live document has those uuids, so nothing looks them up — but the table carries them until `atlas_history` is rebuilt. Give the html-era artifact a `supersedes` list if that ever needs to be exact.
- Separate effort: `scripts/aux/atlas-history/` (on-chain polls / edit-proposal enumerators) is the *genesis* pre-history research, not part of this loop.
