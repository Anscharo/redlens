# Pre-git history scripts (`prehist:*`)

Off the `pnpm build` chain, `ancient-history` branch only — the same pattern as
`scripts/htmlhist/` (see its own `HISTORY.md`), one stage further back in time.
htmlhist reconstructs root (4e931dfd, 2025-05-28) → #117; `prehist:*` reconstructs
everything **before** root: the MIP-era Atlas (2023–2024) and the recovered Atlas v2
genesis snapshot (2024-09-02). Full design: `docs/plans/pre-git-history.md`.

## Run order

```bash
pnpm prehist:genesis   # stage 1: bridge genesis -> root, write public/history-pre-era.json
pnpm prehist:mip       # stage 2: attribute genesis docs to the MIP-era Atlas, append events
pnpm prehist:aep       # stage 1c: replace select severed placeholders with dated AEP facts — MUST run last
pnpm build:history      # upserts public/history-pre-era.json into atlas_history, same as html-era
```

`prehist:mip` reads the `bridge` array `prehist:genesis` writes — always run genesis
first. `prehist:aep` replaces rows that `prehist:genesis` generates — always run it
**last**, after both of the others (re-running genesis or mip regenerates the generic
placeholder `prehist:aep` replaces). All three are deterministic (no network, no
randomUUID) but idempotent in different ways: `prehist:genesis` overwrites
`public/history-pre-era.json` from scratch every run (matching the html-era
freeze-artifact discipline — `prepare-html-history.mjs`'s own comment: "historical
diffs must not silently change"); `prehist:mip` and `prehist:aep` both read-modify-
write the *existing* file (drop-then-append for mip, find-and-replace-by-docId for
aep) so they're each safe to re-run alone without needing the earlier stages to
re-run too — **except** that re-running genesis or mip after aep undoes aep's work,
per the ordering rule above.

| Command | Does | Reads → Writes |
| --- | --- | --- |
| `pnpm prehist:genesis` | Parses the committed genesis HTML, threads REAL root uuids via `scripts/htmlhist/run-thread.mjs` (same identity resolution the html-era pipeline ships — not a heuristic re-derivation), bridges genesis→root (`matchNodes` + Gate-2 corroboration), emits `genesis`/`severed` origin events + graveyard tombstones. | `recovered/genesis-2024-09-02.html` + `vendor/next-gen-atlas` git log + `public/history-decisions.json` → `public/history-pre-era.json` (`events` + `bridge`) |
| `pnpm prehist:mip` | Shingle-containment attribution of every bridged genesis doc against the six Atlas v1 artifacts (Gate-4 calibrated auto-lock ≥0.05), dated via the committed section-dates lookup. | `recovered/mip-corpus.json` + `recovered/mip-section-dates.json` + `public/history-pre-era.json`'s `bridge` → appends `mip` events into the same file |
| `pnpm prehist:aep` | Replaces the generic severed-birth placeholder for a small, hand-curated list of docs with a dated, sourced fact ("Present in Atlas Edit Proposal N") — only for `Accepted` AEPs (hard-throws on any other status); see docs/plans/pre-git-history.md "Stage 1c". | `scripts/prehist/aep-upgrades.json` + `public/history-pre-era.json` → same file, in place |

All three accept `--measure` (print stats/diff, write nothing). `prehist:aep` changes
a row's `commit_sha`, so the old generic `severed:…` row isn't touched by upsert alone
(different conflict key) — it records what it superseded in the artifact's
`supersedes` array, and `build:history` reads that array and `DELETE`s each stale row
before upserting, automatically, every run. No manual DB step needed.

## Gotchas

- **`prehist:genesis` re-runs the full 79-commit html-era thread** (`run-thread.mjs`)
  to get real root uuids — same cost as `htmlhist:apply` (a few minutes). This is
  deliberate: a `(docNo|title)` heuristic join against the frozen JSON artifact was
  measured to silently assume event order matches node order for colliding keys (see
  the plan's "ride-along decisions"); re-threading removes the assumption.
- **`prehist:mip` needs zero network access** — the mips-repo corpus and section
  dates are committed JSON (`scripts/aux/atlas-history/recovered/`), not a live clone.
  Keep it that way; don't reintroduce a `sky-ecosystem/mips` clone into the build path.
- **The genesis HTML gotcha**: if `recovered/genesis-2024-09-02.html` is ever
  re-fetched from ipfs.io, strip the Cloudflare-injected honeypot `<a>` before
  trusting the bytes (see `scripts/aux/atlas-history/README.md`) — verify sha256
  against the CID digest before overwriting the committed copy.
- **Ambiguous/contained genesis docs (16 + 28) are deliberately silent** — no
  genesis event, no tombstone, no severed marker. They keep whatever history they
  already have until a future curation pass resolves them; Phase A never guesses.
- **`public/history-pre-era.json` is committed**, same as `history-html-era.json` —
  it's what `build:history` upserts on both dev and Railway.
