# Atlas history scripts — what they are, when to run them

There are **two separate history pipelines**. Don't mix them up.

## A. Live history (production — runs itself)

| Command | Does | When |
| --- | --- | --- |
| `pnpm build:history` | git log of the atlas submodule → Postgres `atlas_history` (or `--out-json` → `public/history/<uuid>.json`) | Automatic, every atlas-worker cycle. You rarely run it by hand. Covers the post-#117 (atomized markdown) era. |

That's the whole modern story. Everything below is the **pre-#117 (HTML-era) reconstruction** — offline, `ancient-history` branch only, run deliberately.

## B. HTML-era reconstruction (`htmlhist:*`)

Lifecycle order. `prepare` produces a baseline artifact; `curate` decides the ambiguous threading; `apply` bakes those decisions back in; `audit`/`trace` check quality.

| Command | Does | Reads → Writes |
| --- | --- | --- |
| `pnpm htmlhist:prepare` | Build the frozen pre-#117 history artifact (no curation). Deliberate, reviewed reruns only. | 79 HTML commits + #117 seed → `public/history-html-era.json` |
| `pnpm htmlhist:curate` | **Build the decision queue AND auto-resolve it** in one shot — forward∩reverse (free, deterministic) + LLM∩matcher (≥90% confident). Auto-resolves ~half; the rest is for a human. | git history → `public/history-curation.json` (queue) + `public/history-auto-decisions.json` (auto baseline the UI pre-fills) |
| *(web UI `/reports/history-curate`)* | Review the residual cases by hand (auto-resolved ones are pre-filled ✓), then **export decisions**. | queue + baseline → `history-decisions.json` (downloaded) |
| `pnpm htmlhist:apply <decisions.json>` | Bake the human/auto decisions into the frozen artifact. | decisions → re-freezes `public/history-html-era.json` |
| `pnpm htmlhist:audit` | Measure threading accuracy (stratified-samples + LLM-grades). Review report only — never artifact data. | → `.cache/audit-html-report.json` |
| `pnpm htmlhist:trace` | Independent forward pass vs the reverse threading — agreement / conflicts cross-check. Review report only. | → `.cache/forward-reverse-diff.json` |

### Typical pass

```bash
pnpm htmlhist:curate                 # build queue + auto-resolve (~half done for you)
#  → review residual at /reports/history-curate, export history-decisions.json
pnpm htmlhist:apply history-decisions.json
#  (pnpm htmlhist:audit / htmlhist:trace any time you want a confidence check)
```

### Useful flags on `htmlhist:curate`

- `--no-llm` — skip the LLM pass; just build the queue + the free forward∩reverse auto-resolve (fast, no API spend).
- `--limit N` / `--concurrency N` / `--threshold X` — cap/parallelize/tune the LLM cross-check.
- `--stats` — print queue counts only, write nothing.

To **re-run the auto-resolution over an existing queue** without rebuilding the 6 MB queue (e.g. after changing `--threshold`), call the standalone tool directly: `bun scripts/aux/auto-curate-html-history.mjs`.

### Notes

- `public/history-curation.json`, `public/history-auto-decisions.json`, and `public/history-html-era.json` are **gitignored** (local-only / frozen-on-demand). The audit + trace write only to `.cache/`. None are on the `pnpm build` path, so determinism/reproducibility are untouched.
- The Bun server does **not** hot-reload routes — if `/api/history-curate/propose` 404s in the UI, restart `pnpm dev`.
- Separate effort: `scripts/aux/atlas-history/` (on-chain polls / edit-proposal enumerators) is the *genesis* pre-history research, not part of this loop.
