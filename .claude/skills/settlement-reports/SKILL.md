---
name: settlement-reports
description: >
  Knowledge base and audit runbook for Soter Labs Monthly Settlement Cycle
  (MSC) workbooks — the xlsx files behind public/settlements.json and Radar's
  Monthly settlement section. Use when running or changing pnpm
  settlements:parse, editing scripts/lib/settlement-xlsx.mjs,
  scripts/aux/parse-settlements.mjs, src/lib/settlements.ts,
  src/lib/settlementSankey.ts or src/components/radar/ActorSettlement*, when a
  new month or prime is published, or when asked to audit / reconcile / check
  the accounting of settlement figures. Covers what cost of funds is and its
  formula, the two accounting invariants (supply-side basis; CoF is not a
  fourth flow), the fail-loud parsing contract, what each reconcile() delta
  actually detects, and known upstream defects. Keywords: settlement, MSC,
  monthly settlement cycle, cost of funds, CoF, supply kept, supply-side
  revenue, profit to grove, profit to sky, sd_revenue, SDE, sky direct
  exposure, prime agent revenue, agent rate, distribution rewards, spread
  reimbursement, settlements.json, soterlabs, settlement-cycle, Soter.
---

# Monthly Settlement Cycle reports

Soter Labs publishes a monthly settlement workbook per Prime Agent. SAbR
parses them into `public/settlements.json` and charts them on
`/radar/:slug/settlements`. These are **OEA calculations, not the on-chain
GovOps spell** — say so wherever figures are surfaced.

Two upstream repos, both public and cloneable:

| Repo | What it is |
|---|---|
| `soterlabs/settlement-reports` | Published artifacts: `reports/<prime>/<YYYY-MM>/*.xlsx` + `summary.md` |
| `soterlabs/settlement-cycle` | The Python pipeline that generates them — **the authority on every definition** |

When a number is in question, read `settlement-cycle`. `summary.md` is a
faithful human rendering of the same run; the xlsx is not always.

`pnpm settlements:parse` is deliberately **off** the `pnpm build` chain
(`REPRO=1` builds are offline and deterministic). Use `--dir <path>` against a
local checkout when auditing, and `--dry-run` to print stats without writing.

## What cost of funds is

The interest a Prime owes Sky on the capital Sky minted to it. From
`src/settle/compute/sky_revenue.py`:

```
daily_sky_revenue = utilized × [(1 + apy)^(1/365) − 1]
apy               = base_apy | subsidised_apy
base_apy          = SSR ⊕ spread          30bps; 20bps from 2026-07-23
subsidised_apy    = ref_rate + (base − ref_rate) × T / 24     (24-month ramp)
utilized          = cum_debt − alm_proxy_usds − psm_usds
                             − curve_idle_usds − lending_idle_usds
```

Charged daily on `max(utilized_d, 0)`, not monthly on an average. The
workbook's `CoF on utilized (BR × Net_Subs)` is shorthand for this.

Two deliberate non-deductions, both easy to misread as bugs:

- **Subproxy USDS/sUSDS stays in `utilized`.** It mixes genesis capital,
  treasury, risk capital and realized revenue that does not all correspond to
  ilk debt; deducting it would over-reimburse the prime for capital it never
  borrowed. Subproxy balances earn the *agent rate* instead.
- **sUSDS venues stay in `utilized`.** The prime earns only the BR − SSR
  spread there; SSR appreciation flows back to Sky through this charge.

Utilization varies widely — Obex 100%, Spark 65–80%, Grove 28–50%. A low ratio
is normal, not a red flag.

Cost of funds is **not** an Atlas term. It appears nowhere in
`vendor/next-gen-atlas/content/`; the nearest governance language is A.3's
"cost of capital" for Primes and A.4.4's Base Rate mechanics. Do not cite the
Atlas as its source.

## Invariant 1 — supply-side revenue is `prime_agent_revenue − cof`

Never `Σ` per-venue `Profit to Grove`. `src/lib/settlements.ts` exposes the
correct figure as `supplyKept()`; upstream it is `src/settle/load/summary.py`,
and it is what the published `summary.md` prints.

The venue-row sum silently drops prime-level revenue that has no venue row
(PSM3 sUSDS appreciation) plus the sUSDS spread reimbursement:

```
Σ profit_to_grove   = Σ revenue − cof − Σ spread_reimb
prime_agent_revenue − cof                                  ← correct
gap                 = (prime_agent_revenue − Σ revenue) + Σ spread_reimb
```

Across the 36 workbooks published as of 2026-08 the gap is **$7.29M, all of it
Spark** (7.5–11.6% per month; 2026-01 showed −$1,353,894 against Soter's
published −$338,954, and 2026-04 flips sign). Other primes have no non-venue
revenue and no spread reimbursement, so both bases coincide and the bug is
invisible on them — **always test against Spark.**

`summary.py` states the reason directly: *"Summing rows would silently drop
those."*

Per-venue `profitToGrove` is still correct **as a venue breakdown** — the
Sankey and venue table use it legitimately. Only its *sum* must never become a
headline.

## Invariant 2 — cost of funds is not a fourth flow

`settlement-cycle` derives `cof = sky_revenue − sde_revenue`
(`build_settlement_xlsx.py`). The causality runs *Sky-revenue → CoF*, so cost
of funds **is** the money sent to Sky, differing only by Sky Direct Exposure —
identical for Obex (SDE = 0), under 0.5% apart for Spark, materially different
only for Grove (SDE $2.9M–$6.4M).

Render it as a component of "To Sky" (`HeadlineFigure.component`), never as a
peer row, or readers add the two and count Sky's take twice. Sky Direct
Exposure is the other component (`cof + sde = skyRevenue`); show it the same
way whenever it is non-zero so Grove's remainder is labeled.

The three genuine flows, which foot to `$0.00` on all 36 workbooks:

```
prime_agent_revenue + demand + sde
  = skyRevenue  +  (prime_agent_revenue − cof)  +  demand
    [to Sky]        [supply kept]                  [agent rate + DR + CP + GAR]
```

`demandSideRevenue()` must have **no fallback** to `primeAgentTotalRevenue` —
that is the whole prime-side total, already counted by the other two terms.

## Parsing contract

`parseSummary` **throws** on a Summary label it cannot match
(`REQUIRED_SUMMARY_ROWS`), mirroring what `parseVenues` has always done for its
headers. This is load-bearing, not pedantry: `cellNum` returns `0` for a
missing cell, and `0` is a legitimate CoF — Keel and Skybase genuinely settle
at zero — so a renamed label is otherwise indistinguishable from a real zero.
Upstream already spells it two ways: `CoF on utilized` in the xlsx, `prime cost
of funds` in `summary.md`.

Adding a required row means adding it to `REQUIRED_SUMMARY_ROWS` **and**
confirming it exists in every published workbook first — optional rows
(`distribution_rewards`, `chronicle_points`, `gar`) are emitted only when
non-zero and must stay optional.

The Summary parser relies on `section = null` after each block total. Without
it, the `Sky Revenue (max)` block that follows `Sky side` would be captured as
`skyRevenue`. Preserve that reset.

## What each `reconcile()` delta actually detects

| Delta | Detects |
|---|---|
| `dCof` | **The one that bites.** `Σ CoF alloc − Σ Spread Reimb ≡ headline.cof` — catches a renamed/zeroed CoF label. The allocation is of the *gross* CoF, with the spread refunded inside `Profit to Sky`, which is why it nets. |
| `dRevenue` | Real: the non-venue slice (Spark's PSM3). Informational, not a flag. |
| `dComparisonFoot` | An upstream rendering bug we measure but cannot fix (below). |
| `dSky`, `dP2G` | Near-nothing. Both restate the venue table against block totals derived from that same table, so they are `~0` by construction. Do not treat them as assurance. |

## Known upstream defects

Both in `scripts/build_settlement_xlsx.py`, both from using `_block`
(*header → addends → total*) for relationships that are not sums.

1. **`Comparison (Grove-style "Profit to Grove")` does not foot.** Prints
   `prime_agent_revenue` and `− CoF` as addends, totals with `Σ
   profit_to_grove`. Affects the 7 Spark workbooks. This is the trap behind
   Invariant 1 — ignore the block's total and compute `par − cof`.
2. **`Sky Revenue (max)` is inverted.** Addends sum to `2·cof − sky_gross`
   against a printed total of `sky_gross`; the real relation is `sky_gross −
   reduction = cof`. The block is present on 22 of 36 and fails to foot on
   15 (Spark, Grove, Osero). It foots only for Obex (reduction = 0). Keel
   and Skybase omit the block (`sky_gross = 0`). Display-only; SAbR does
   not read it. The Sky Revenue sheet dumps the same three numbers as `↳`
   rows without a false total — the children still do not add to the parent.
   Independent verification: `docs/reviews/2026-08-19-soter-xlsx-footing.md`.

## Audit runbook

For a new month, a new prime, or any change to the parse/display path:

1. **Get real workbooks.** `git clone --depth 1
   https://github.com/soterlabs/settlement-reports /workspace/soterlabs/settlement-reports`
   (public, no auth). The synthetic fixtures in `scripts_tests/` are built to
   satisfy the identities and will not catch a basis error.
2. **Parse them.** `node scripts/aux/parse-settlements.mjs --dir
   /workspace/soterlabs/settlement-reports --dry-run`. Expect **0 flags**. A
   `dCof` flag means the CoF label or the allocation changed — read the sheet
   before touching the parser.
3. **Cross-check against `summary.md`, not just the xlsx.** For each prime,
   `supplyKept` must equal the `**supply-side revenue**` line in that month's
   `summary.md` Prime side block. This is the check that catches a basis
   regression; the xlsx alone cannot.
4. **Verify the three-way foots.** `skyRevenue + supplyKept + demand` must
   equal `prime_agent_revenue + demand + sde` to `$0.00` on every report.
5. **Check the Spark row specifically.** Any bug in supply-side basis is
   invisible on Grove/Obex/Keel/Skybase/Osero.
6. **Run the suites.** `npx vitest run src/lib/settlements.test.ts
   src/lib/settlementSankey.test.ts scripts_tests/settlement-xlsx.test.ts`.

When upstream adds a prime, `identifyReport` skips `non_msc` and `sky_total`
(aggregators, not primes) via `SKIP_PRIMES` — extend that set rather than
filtering downstream. Radar matching lives in `settlementPrimeKeys()`, which
also resolves `<slug>-party` composite pages.
