# Settlement workbook display defects (settlement math unaffected)

**Scope:** all 36 published prime workbooks + `summary.md`, Jan–Jul 2026 (`settlement-reports@98e63d3`), checked against `settlement-cycle@10cdfe05`.

**Not in question:** the settlement identities hold on every report — the Prime-side and Sky-side Summary blocks foot, `summary.md`'s supply-side revenue equals `prime_agent_revenue − CoF`, Σ venue revenue + PSM3 sUSDS appreciation equals PAR to the cent, and the mint path (`sky_total_accrual.py`) pays `par − (sky − sde)`. The three items below are presentation defects in the published surfaces: numbers a reader will take at face value and mis-reconstruct.

## 1. Summary tab — the "Comparison" block's bold total is not the sum of its rows

`build_settlement_xlsx.py:229` renders the block with `_block` (header → addends → bold total), the same grammar every other Summary block uses for a real sum. Here the total is a different quantity than the addends:

- rows: `prime_agent_revenue`, `− CoF` — their sum is the prime's supply-side revenue;
- bold total: `Σ` per-venue `profit_to_grove`.

The two differ by (a) prime-level revenue with no venue row (PSM3 sUSDS SSR appreciation) and (b) the sUSDS spread reimbursement, because `cof_alloc` distributes the **gross** CoF (`grove_sheet.py`: `CoF_total = sky_revenue + Σ spread_reimb − Σ sd_revenue`).

Spark January 2026, from the published xlsx:

| Summary row | USD |
|---|---:|
| `prime_agent_revenue` | 7,503,304.56 |
| `− CoF (deducted per-venue in display)` | −7,842,258.86 |
| sum of the rows (= `summary.md` supply-side revenue) | **−338,954.30** |
| printed bold total | **−1,353,894.23** |

A reader trusting the bold row sees a January loss ~4× the real one; April flips sign (+1,267,818.55 real vs −25,009.42 printed). All seven Spark workbooks are affected — the only prime with non-venue revenue and material spread — and Jan–Jul the two figures diverge by **$7,290,483.28** in total. The gap equals PSM3 appreciation + spread to the cent every month (July: 111,594.67 + 82,524.78 = 194,119.45). The muted "sUSDS spread…" line above the block covers only the spread half, and nothing marks the bold total as a different basis.

`Σ profit_to_grove` is a valid venue breakdown; the defect is presenting it as the total of `par − CoF` addends. Related: the `grove_sheet.py` module docstring asserts `Σ_v Profit_to_Grove_v ≡ prime_agent_revenue`, which the module's own formula (`Σ revenue − CoF_total`) contradicts — likely how the mismatched total ended up under these rows.

**Fix:** either `total = par − cof` with `Σ profit_to_grove` on its own labelled row, or keep `total = Σ profit_to_grove` and add `− PSM3 sUSDS appreciation` and `− sUSDS spread reimbursement` as addends so the block foots.

## 2. Summary tab — "Sky Revenue (max)" addends sum to `2·cof − sky_gross`

`build_settlement_xlsx.py:210`: the rows are `cof` and `−(sky_gross − cof)` while the printed total is `sky_gross`. The intended relation is a waterfall — `sky_gross − reduction = cof` — not a sum. Spark July 2026: rows 5,755,899.02 and −3,043,688.23 sum to 2,712,210.79 against a printed total of 8,799,587.25. The block fails to foot on 15 of the 22 workbooks that render it (Spark, Grove, Osero) and foots only where the reduction is 0 (Obex). Display-only diagnostic, but it uses the same bold-total grammar as the blocks that do sum.

**Fix:** reorder as `sky_gross → − deductions → total = cof`.

## 3. Venues tab — "Period inflow" column contains ΔNAV, not `period_inflow`

`build_settlement_xlsx.py:287` writes `value_eom − value_som` (commented `# period_inflow proxy`) under the header "Period inflow", although `provenance.json` already carries the true per-venue `period_inflow` (`provenance.py:91`) and `summary.md` prints it. Since `actual_revenue = Δvalue − period_inflow`, the column differs from the true figure by exactly the venue's booked revenue (plus fee/adjustment paths) — yield reads as a capital movement — and the xlsx contradicts `summary.md` by ≥$1k on 21 of 36 workbooks. Examples: Obex Jul V1 −213,522,548.20 vs true −216,048,528.31 (+2,525,980.11); Grove Apr E9 63,724,995.01 vs 59,960,119.25 (+3,764,875.76); Spark May S32 off by +5,855,337.62.

**Fix:** write provenance `period_inflow` into the column — one line.

## Smaller trail gaps, worth fixing while in there

- `summary.md`'s per-venue table has no `external_revenue` / fee / adjustment columns, so `actual = Δvalue − inflow` fails silently for those paths: Grove Jul E1 shows revenue 1,586,143.24 vs actual 117,961.80 with the 1,468,181.44 Merkl slice visible only in the xlsx; Grove Jun E21 shows Δvalue −18,721,388.15, inflow 0.00, actual +371,738.69 (cash-distribution coupon; principal moves never enter `period_inflow`); Spark S32's depositor-SSR adjustment (Jul −834,617.19 vs raw MtM) carries no note.
- Two headline lines are both titled "**supply-side revenue**" — prime (`par − CoF`) and Sky (`CoF + SDE`); Spark Jul prints 2,846,721.64 and 5,750,694.26 under the same label. Rename one.
- `docs/METHODOLOGY.md` §sky_savings_token still says `prime_revenue = 0`; Case-1 venues now book natural MtM (S43 Jul actual 431,179.34).

None of the above changes what is paid. All of it changes what a third party reconstructs from the published files — and there is currently no test asserting that xlsx Summary blocks foot, so the pattern can recur silently.
