# Soter MSC workbooks: two Summary-tab footing bugs

**Date:** 2026-08-19
**Repos checked:** [`soterlabs/settlement-cycle@10cdfe0`](https://github.com/soterlabs/settlement-cycle/commit/10cdfe05a2875cb8f294e30b91ebeffa81de0025) (pipeline) and [`soterlabs/settlement-reports@98e63d3`](https://github.com/soterlabs/settlement-reports) (all 36 published prime workbooks, Jan–Jul 2026).
**Question:** do two draft “upstream issues” against the xlsx Summary tab describe a real settlement-accounting error, or only a display / parser trap?

---

## Bottom line

**The settlement numbers are fine. Two blocks on the xlsx Summary tab do not foot.**

Soter’s published `summary.md`, `provenance.json`, and the mint/send formula all use `prime_agent_revenue − cost of funds` for the prime’s supply-side share. Those identities hold to the cent on every workbook.

What does *not* foot is the **unlabeled bold total** on two Summary blocks that reuse a “header → addends → total” layout for relationships that are not sums. A human or parser that treats that bold row as the sum of the rows above it will misread Spark. A BA Labs / `summary.md` / forum-post cross-check will not catch this, because those surfaces never use those two totals.

| Draft issue | Real? | Affects what Soter pays / publishes in `summary.md`? |
|---|---|---|
| 1. Comparison (Grove-style “Profit to Grove”) does not foot | **Yes — exact, Spark only** | **No** |
| 2. Sky Revenue (max) addends do not sum to the printed total | **Yes — exact, wherever the block exists and idle/SDE ≠ 0** | **No** (display-only by design) |

If this is filed upstream, frame it as an **xlsx Summary presentation bug** (`_block` used for a non-sum), not as “MSC paid the wrong amount.”

---

## What was re-checked independently

Not taken on trust from the draft:

1. Read `scripts/build_settlement_xlsx.py` and `src/settle/load/summary.py` / `grove_sheet.py` at `10cdfe0`.
2. Parsed all 36 prime `*_settlement_*.xlsx` files with openpyxl (not SAbR's parser).
3. Compared every Comparison addend total to that month’s `summary.md` **supply-side revenue**.
4. Confirmed the mint/send path (`src/settle/compute/sky_total_accrual.py`) uses `par − (sky − sde)`, i.e. the same `par − CoF`, never `Σ Profit to Grove`.

Controls that passed on **36/36** workbooks:

- Prime-side block foots (`prime_agent_revenue + agent_rate + DR + …`).
- Sky-side block foots (`CoF + SDE = sky_revenue`).
- `summary.md` prime supply-side = xlsx `par − CoF` (≤ 2¢).
- `Σ` Venues-tab **Profit to Sky** = Sky-side total.

---

## Issue 1 — Comparison block (the one that matters for readers)

**Code:** `scripts/build_settlement_xlsx.py` lines 229–236.

The block prints `prime_agent_revenue` and `− CoF` as addends, then totals with `Σ` per-venue `profit_to_grove`:

```python
_block(
    'Comparison (Grove-style "Profit to Grove")',
    rows=[
        ("prime_agent_revenue",                    par),
        ("− CoF (deducted per-venue in display)",  -cof),
    ],
    total=sum_p2g,          # not par − cof
)
```

`_block` is documented as “header → addends → blank-label total row.” Prime side and Sky side use it correctly. Here the total is a **different basis** from the rows above, but it renders with the same bold, top-bordered total styling.

### Reproduction — Spark January 2026

From the published xlsx Summary tab:

| Summary row | Value |
|---|---:|
| `prime_agent_revenue` | 7,503,304.56 |
| `− CoF (deducted per-venue in display)` | −7,842,258.86 |
| **addends** (`par − CoF`) | **−338,954.30** ← `summary.md` **supply-side revenue** |
| **printed bold total** | **−1,353,894.23** |
| off by | **1,014,939.93** |

January therefore shows a loss ~4× the real one if you trust the unlabeled total. April **flips sign** (real `+1,267,818.55`, printed `−25,009.42`).

### All seven Spark months (matches the draft to the cent)

| Report | `par − CoF` (`summary.md`) | printed total (`Σ P2G`) | off by |
|---|---:|---:|---:|
| spark/2026-01 | −338,954.30 | −1,353,894.23 | 1,014,939.93 |
| spark/2026-02 | 2,772,995.70 | 1,658,047.72 | 1,114,947.97 |
| spark/2026-03 | 2,486,880.27 | 1,175,031.08 | 1,311,849.18 |
| spark/2026-04 | 1,267,818.55 | −25,009.42 | 1,292,827.97 |
| spark/2026-05 | 2,924,050.02 | 1,543,738.89 | 1,380,311.13 |
| spark/2026-06 | 2,225,436.06 | 1,243,948.42 | 981,487.65 |
| spark/2026-07 | 2,846,721.64 | 2,652,602.19 | 194,119.45 |

**Scope:** 7 of 36 published prime workbooks, **all Spark**. Grove, Obex, Keel, Skybase, and Osero foot — they have no PSM3 sUSDS appreciation and (except Spark) no material sUSDS spread reimbursement, so the two bases coincide.

Printed Comparison total = `Σ` Venues-tab Profit to Grove on every workbook (including Spark). The addends equal `summary.md`. Only Spark’s unlabeled total disagrees with the addends.

### Why the two numbers differ (identity, not a coincidence)

Per-venue `profit_to_grove = revenue − cof_alloc`, and CoF is allocated **gross** of the sUSDS spread refund. Prime-level `prime_agent_revenue` also includes PSM3 sUSDS SSR appreciation, which has no venue row.

```
Σ P2G = Σ venue revenue − cof_gross
      = (par − psm3_appreciation) − (net_CoF + total_spread)

⇒ (par − CoF) − Σ P2G  =  psm3_appreciation + total_spread
```

This holds to ≤ 1¢ on all seven Spark months. Cumulative gap **$7,290,483.28**.

Largest relative miss: January, **11.60%** of that month’s Prime-side total (`1,014,939.93 / 8,750,181.86`). July is only ~2% of the Prime-side total.

The causal story “two prime-level items with no venue row” is **mostly** right (~90–95% of the gap is PSM3 appreciation + PSM3/Curve spread). The rest is Cat B L2 `spread_reimb`, which *does* have a venue row; it still lands in the gap because Profit to Grove never credits the spread (Profit to Sky does). In July that Cat B slice is **38%** of the gap.

### What actually gets settled

`src/settle/load/summary.py` already computes the canonical figure as `prime_agent_revenue − prime_cof`, with a comment that summing venue rows would drop the prime-level additions.

`src/settle/compute/sky_total_accrual.py` (mint/send):

```
sv = prime_agent_revenue − (sky_revenue − sde_revenue)   # = par − CoF
```

So the money path and the markdown report agree with the Comparison *addends*, not the Comparison *total*.

`grove_sheet.py`’s module docstring still claims `Σ Profit to Grove ≡ prime_agent_revenue`. That identity is false whenever CoF is allocated (P2G is after CoF). Likely why `total=sum_p2g` was placed under `par` and `− CoF` as if they were the same number.

---

## Issue 2 — Sky Revenue (max) (display-only)

**Code:** `scripts/build_settlement_xlsx.py` lines 210–217.

```python
_block(
    "Sky Revenue (max) — BR × full ilk debt, no deductions",
    rows=[
        ("CoF on Net_Subs (actual BR × utilized)",         cof),
        ("reduction from idle/SDE deductions",             -(sky_gross - cof)),
    ],
    total=sky_gross,
)
```

Addends sum to `2·cof − sky_gross`, not `sky_gross`. The intended reading is `sky_gross − |reduction| = cof`.

### Reproduction — Spark July 2026

| Summary row | Value |
|---|---:|
| CoF on Net_Subs | 5,755,899.02 |
| reduction from idle/SDE deductions | −3,043,688.23 |
| **addends** | **2,712,210.79** |
| **printed total** (`sky_gross`) | **8,799,587.25** |
| intended (`gross − |reduction|`) | **5,755,899.02** (= CoF) |

`MonthlyPnL.sky_revenue_gross` is documented as **not part of any settlement invariant**.

### Scope (the “29 of 36” count in the draft is wrong)

| Bucket | Count |
|---:|---:|
| No block (`sky_gross = 0`: Keel + Skybase) | 14 |
| Block present and foots (Obex, reduction = 0) | 7 |
| Block present and does not foot (Spark + Grove + Osero) | **15** |
| Total prime workbooks | 36 |

“Foots only for Obex” is true *among workbooks that render the block*. Counting 29 = 36 − 7 Obex incorrectly includes the 14 that never print the block.

The Sky Revenue *sheet* dumps the **same three numbers** (verified on all 22 blocks that have them). It is less misleading only because there is no bold total claiming the ↳ rows sum to the parent. The ↳ children still do not add to `sky_gross`.

---

## Suggested upstream fix (if filing)

**Issue 1** — any of:

1. Pass `total=par - cof` so the block foots, and put `Σ` per-venue Profit to Grove on its own labelled row.
2. Keep `sum_p2g` but do not use `_block` (no addend/total grammar) — this is a comparison of two bases, not a sum.
3. Do **not** add `+ psm3` and `+ spread` as reconciling rows under the current total: that moves the addends *away* from `sum_p2g`. To reach `Σ P2G` from `par − CoF` those items have to be subtracted.

**Issue 2** — reorder to waterfall `sky_gross → − deductions → total=cof`, or drop `_block` and keep the ↳ dump without a false total. Lower priority.

There is no settlement-cycle test that asserts xlsx Summary blocks foot. Prime side / Sky side were never going to catch this.

---

## How to read the workbooks until this is fixed

- Prime supply-side revenue = **`prime_agent_revenue − CoF`**, which is the Comparison *addends* and the `summary.md` line. Ignore the Comparison block’s unlabeled total on Spark.
- Per-venue Profit to Grove is a valid *venue breakdown* (pro-rata CoF allocation). Its sum is not the headline.
- `Sky Revenue (max)` on Summary is a diagnostic ceiling, not an invoice line.
