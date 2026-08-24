# Cross-verification of the three settlement-cycle audits

**Date:** 2026-08-20
**Question:** the three audits of `soterlabs/settlement-cycle` (the skill's Known-upstream-defects section from the 2026-08 parse audit; the footing note `2026-08-19-soter-xlsx-footing.md` on PR #301; the "Settlement-cycle financial audit (3rd)" comment on PR #301) each report display defects. Do they agree, are they accurate, and is anything fabricated — safe to escalate upstream?
**Method:** independent re-derivation from primary sources only. All 36 published prime workbooks at [`settlement-reports@98e63d3`](https://github.com/soterlabs/settlement-reports) parsed with raw openpyxl (not RedLens's parser, not the audits' scripts); every `summary.md` parsed by regex; pipeline code read at [`settlement-cycle@10cdfe0`](https://github.com/soterlabs/settlement-cycle/commit/10cdfe05a2875cb8f294e30b91ebeffa81de0025). The settlement-reports skill was deliberately **not** trusted as ground truth — it is itself audit output.

---

## Verdict per finding

| Finding | Claimed by | Verified? |
|---|---|---|
| Comparison ("Profit to Grove") block doesn't foot — Spark, 7/7 months | audits 1, 2, 3 | **Yes — to the cent.** All seven printed totals match audit 2's table exactly; cumulative wedge **$7,290,483.28**; wedge ≡ PSM3 sUSDS appreciation + total sUSDS spread to ≤1¢ every month. Audit 3's competing numbers are wrong (below). |
| Sky Revenue (max) block: addends ≠ printed total | audits 1, 2 | **Yes.** Exactly **14 absent** (Keel, Skybase — `if sky_gross > 0` guard), **7 foot** (Obex, reduction = 0), **15 fail** (Spark 7, Grove 7, Osero 1). Audit 2's corrected count confirmed; audit 1's "29 of 36" was wrong and stays retired. |
| Venues-tab "Period inflow" column shows ΔNAV, not `period_inflow` | audit 3 | **Yes — to the cent.** `build_settlement_xlsx.py:287` writes `value_eom − value_som` (self-labelled `# period_inflow proxy`); `provenance.py:91` proves the true per-venue value exists and was available. Column ≠ `summary.md` `period_inflow` by >$1k on **21/36 workbooks**. All four cited examples exact: Spark May S32 +5,855,337.62; Grove Apr E9 +3,764,875.76; Spark Apr S28 +3,176,375.00; Obex Jul V1 +2,525,980.11. Worst overall: Grove Jun E21 **−18,721,388.15**. |
| `summary.md` per-venue table can't explain external/fee/adjustment rows | audit 3 | **Yes.** Table columns are fixed (`summary.py:291`) with no `external_revenue`/fee/adjustment. Grove Jul E1: revenue $1,586,143.24 vs actual $117,961.80 — the $1,468,181.44 Merkl slice appears **only** in the xlsx `external_revenue` column, nowhere in that month's `summary.md` (no "Merkl"/"external" text at all). |
| E21/E38 cash-distribution rows: coupon booked, principal never in inflow | audit 3 | **Yes.** Grove Jun E21: Δvalue −$18,721,388.15, inflow $0.00, actual +$371,738.69, no explanatory note in the file. `cash_distributions` override confirmed in `monthly_pnl.py`. |
| Spark S32 depositor-SSR carve-out applied but not shown | audit 3 | **Yes.** Jul: MtM identity gives $2,131,094.49, published actual $1,296,477.30 — adjustment **−$834,617.19**, exact; no note in `summary.md`. Mechanism = Case 2 in `monthly_pnl.py` (PRD §10). |
| Two headline lines both titled "supply-side revenue" | audit 3 | **Yes.** `summary.py:209` (prime, par − CoF) and `:274` (Sky total). Spark Jul: $2,846,721.64 vs $5,750,694.26 — audit 3's example exact. |
| `docs/METHODOLOGY.md` stale re `sky_savings_token` | audit 3 | **Yes.** Doc says `prime_revenue = 0`; Case-1 code comment (naming S43) books natural MtM; S43 Jul revenue **$431,179.34** ≠ 0, spread $33,135.87 — both exact. |
| Money path unaffected (display-only) | audits 2, 3 | **Yes.** `sky_total_accrual.py:148`: `sv = par − (sky − sde)`. Controls pass 36/36: Prime-side and Sky-side blocks foot; Comparison addends ≡ `summary.md` supply-side; printed Comparison total ≡ Σ Venues-tab P2G; Σ venue revenue + PSM3 appreciation ≡ PAR (≤2¢); Grove Jul CoF 3,299,017.14 + SDE 4,704,533.20 = sky 8,003,550.33 (1¢); Skybase GAR 105,174.26 = 1% × 10,517,425.81. |

Spot-checked and exact from audit 3's supporting material: July headline table for Spark/Grove/Obex (all six figures each), S23 Anchorage dust (som $1.35), S26 interest booking (inflow −1,198,969 / actual +1,198,969), Spark Jul PSM3 appreciation 111,594.67, Uni V3 idle note (`sky_revenue.py:64`), `MonthlyPnL.__post_init__` invariant. The Obex-vs-forum APR/APY item is out of scope of these repos and was not verified.

## The one real inter-audit conflict — audit 3's Spark table

Audit 3's "Xlsx P2G" and "Wedge (= spread)" columns **do not match the published workbooks**:

| Month | Real printed total (= audits 1–2) | Audit 3's "Xlsx P2G" | Real wedge | Audit 3's "wedge" |
|---|---:|---:|---:|---:|
| 2026-01 | −1,353,894.23 | −460,286.04 | 1,014,939.93 | 121,331.74 |
| 2026-07 | 2,652,602.19 | 2,764,196.86 | 194,119.45 | 82,524.78 |
| Jan–Jul | | | **7,290,483.28** | **1,080,237.14** |

Cause: audit 3's stated scope was code + committed markdown (`provenance.json` is gitignored; it never opened an xlsx). It derived "what the xlsx shows" as `par − gross CoF` — dropping the PSM3-appreciation term, i.e. equating Σ venue revenue with `prime_agent_revenue`, which its **own** passing check ("Σ venue revenue + PSM3 = PAR") contradicts. Its per-month spread figures are all correct; only the identification wedge≡spread is wrong. Its recommended fix 2 ("show spread as its own addend so the total equals the rows") would therefore still not foot on Spark; audit 2's note 3 pre-empts exactly this error.

Nothing was fabricated from thin air — every code quote exists verbatim at the pinned SHA (line numbers included) and every cited venue row is real. But audit 3's two derived columns present modeled numbers as artifact contents, and its sizing of the Comparison issue ($82,525 Jul / ~$1.08M cumulative) understates the actual display discrepancy ($194,119.45 / $7,290,483.28).

## Context the audits under-cited (checked; does not change any verdict)

- The Spark Summary tab does carry a muted `sUSDS spread (Curve LP + PSM3) — deducted from sky_revenue` row (values match `summary.md`'s spread), and `summary.md` has a "Non-venue sUSDS credits" section explaining both wedge components. Partial context for the Comparison gap — but no text marks the bold total as a different basis, and PSM3 appreciation is absent from the xlsx entirely.
- The inflow column's `# period_inflow proxy` code comment shows the proxy is deliberate; the column header still says "Period inflow" and the true value sits unused in provenance.

## Decision: escalate, using audit 2's numbers

File upstream as **xlsx/report presentation defects, explicitly not settlement errors** (all money-path identities hold on 36/36):

1. Comparison block total is Σ per-venue P2G under `par − CoF` addends (Spark 7/7; audit 2's table verbatim).
2. Sky Revenue (max) addends sum to `2·cof − sky_gross` (15 of the 22 workbooks that render it).
3. Venues "Period inflow" column should carry provenance `period_inflow`, not ΔNAV (audit 3's examples verbatim; 21/36 affected, worst −$18.7M).
4. Secondary: `summary.md` columns for external/fee/adjustment + cash-distribution principal; S32 carve-out note; rename one "supply-side revenue"; refresh METHODOLOGY §sky_savings_token.

Do **not** forward: audit 3's "Xlsx P2G"/"Wedge (= spread)" columns or its $82.5k/$1.08M sizing, audit 3's fix 2 as phrased, audit 1's retired "29 of 36" count.
