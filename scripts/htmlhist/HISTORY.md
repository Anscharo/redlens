# Atlas history scripts — what they are, when to run them

There are **two separate history pipelines**. Don't mix them up.

## A. Live history (production — runs itself)

| Command | Does | When |
| --- | --- | --- |
| `pnpm build:history` | git log of the atlas submodule → Postgres `atlas_history` (or `--out-json` → `public/history/<uuid>.json`) | Automatic, every atlas-worker cycle. You rarely run it by hand. Covers the post-#117 (atomized markdown) era. |

That's the whole modern story. Everything below is the **pre-#117 (HTML-era) reconstruction** — offline, `ancient-history` branch only, run deliberately.

## B. HTML-era reconstruction (`htmlhist:*`)

Lifecycle order. `prepare` produces a baseline artifact; `curate` decides the ambiguous threading; `apply` bakes those decisions back in; `audit` double-checks **every** applied decision with an independent second model (then a reviewer adjudicates the disagreements); `trace`/`audit:accuracy` give extra confidence cross-checks.

| Command | Does | Reads → Writes |
| --- | --- | --- |
| `pnpm htmlhist:prepare` | Build the frozen pre-#117 history artifact (no curation). Deliberate, reviewed reruns only. | 79 HTML commits + #117 seed → `public/history-html-era.json` |
| `pnpm htmlhist:curate` | **Build the decision queue AND auto-resolve it** in one shot — forward∩reverse + reverse∩containment (free, deterministic) + LLM∩matcher (≥90%). Add `--frontier` to escalate the uncertain residual to a frontier model (locks on an independent 2nd signal, else writes a hint). | git history → `public/history-curation.json` (queue) + `public/history-auto-decisions.json` (auto baseline the UI pre-fills) + `public/history-curation-proposals.json` (frontier hints, with `--frontier`) + `public/history-curation-llm-cache.json` (resume cache) |
| `pnpm htmlhist:resume` | **Continue the frontier in batches** — reuses the existing queue + the resume cache (every prior LLM/frontier ask), so a capped run never re-spends; the `--frontier-limit` is spent only on NOT-yet-asked cases. Run repeatedly to finish the frontier a chunk at a time. | existing queue + cache → grows `history-auto-decisions.json` + `-proposals.json` + the cache |
| *(web UI `/reports/history-curate`)* | Review the residual cases by hand (auto-resolved ones are pre-filled ✓, frontier suggestions shown), then **⤒ save to repo** (dev-only, one click → writes the committed decisions file; ⤓ export downloads as a fallback). | queue + baseline + proposals + committed decisions → `public/history-decisions.json` |
| `pnpm htmlhist:apply [decisions.json]` | Bake the human/auto decisions into the frozen artifact. No arg ⇒ applies the committed `public/history-decisions.json`. **Partial-safe**: undecided cases fall back to the automatic threading. | decisions → re-freezes `public/history-html-era.json` |
| `pnpm htmlhist:audit` | **Pass 1 of the post-curation audit** — independently re-pick the predecessor for **every applied decision** (deterministic, AI, and human) with a cheap second model (`google/gemma-4-31b-it`) and flag every case where it disagrees with the recorded pick. Resumable (caches each ask) + partial-safe (`--limit N`). Then **pass 2** = a reviewer (Claude/human) adjudicates each flagged disagreement and records why. Review report only — never artifact data. | `public/history-decisions.json` + queue → `.cache/audit-html-disagreements.{json,md}` + `.cache/audit-html-decisions.json` (ledger) |
| `pnpm htmlhist:audit:accuracy` | Measure threading **accuracy** (stratified-samples + LLM-grades → a single headline %). The older statistical audit; complements the per-decision one above. Review report only. | → `.cache/audit-html-report.json` |
| `pnpm htmlhist:trace` | Independent forward pass vs the reverse threading — agreement / conflicts cross-check. Review report only. | → `.cache/forward-reverse-diff.json` |

### Typical pass

```bash
pnpm htmlhist:curate --frontier      # build queue + auto-resolve + frontier-advise the residual
#  → review residual at /reports/history-curate, ⤒ save to repo, then:
git commit public/history-decisions.json
pnpm htmlhist:apply                  # applies the committed decisions → re-freezes the artifact
git commit public/history-html-era.json
pnpm htmlhist:audit                  # pass 1: cheap second model re-checks EVERY decision → flags disagreements
#  → review .cache/audit-html-disagreements.md; pass 2: a reviewer (Claude/human) adjudicates each
#  (pnpm htmlhist:trace / htmlhist:audit:accuracy any time you want an extra confidence cross-check)
```

Partial is fine: decide a subset, save, apply, commit — undecided cases keep the automatic
threading and you can come back later. Both the curation inputs and the applied output are
committed, so the page works on any checkout and the reconstruction reproduces from git.

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

### Notes

- The pipeline artifacts (`history-curation.json`, `history-auto-decisions.json`, `history-curation-proposals.json`, `history-decisions.json`, `history-reintroductions.json`, `history-html-era.json`) are **committed** (the reviewed, reproducible reconstruction). The audit + trace write only to `.cache/`. None are on the `pnpm build` path, so frontend-build determinism is untouched.
- **Serving:** `pnpm build:history` upserts the committed `history-html-era.json` into Postgres `atlas_history` (idempotent, via `htmlEraRows`) on every sync, so dev (preflight) and Railway (atlas worker) both serve the applied reconstruction. No separate sync step.
- The Bun server does **not** hot-reload routes — if `/api/history-curate/propose` or `/save` 404s in the UI, restart `pnpm dev`. The `⤒ save to repo` endpoint is **dev-only** (localhost / `CURATION_SAVE=1`); it 404s in prod, where the page is read-only.
- Separate effort: `scripts/aux/atlas-history/` (on-chain polls / edit-proposal enumerators) is the *genesis* pre-history research, not part of this loop.
