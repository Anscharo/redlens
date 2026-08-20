# Settlement workbook display defects (settlement math is unaffected)

**Scope:** all 36 published prime workbooks plus `summary.md`, January–July 2026 (`settlement-reports@98e63d3`), checked against `settlement-cycle@10cdfe05`.

**Not in question:** the settlement math holds on every report. The Prime-side and Sky-side Summary blocks add up; `summary.md`'s supply-side revenue equals `prime_agent_revenue` minus Cost of Funds (CoF); the sum of venue revenue plus PSM3 sUSDS appreciation equals `prime_agent_revenue` within 2¢; and the settlement send (`sky_total_accrual.py`) computes the prime's supply share as `prime_agent_revenue − (sky_revenue − sde_revenue)` — the same `par − CoF`. The three items below are presentation defects in the published files: numbers a reader will take at face value and reconstruct incorrectly.

## 1. Summary tab — the Comparison block's bold total is not the sum of its rows

`build_settlement_xlsx.py:229` draws the block the same way as every other Summary block: header, then rows, then a bold total. Elsewhere that bold figure is the sum of the rows above it. Here it is a different quantity:

- rows: `prime_agent_revenue`, `− CoF` — their sum is the prime's supply-side revenue;
- bold total: the sum of per-venue `profit_to_grove`.

The two differ by (a) prime-level revenue that has no venue row (PSM3 sUSDS appreciation) and (b) the sUSDS spread reimbursement. That is because Cost of Funds is allocated across venues on a gross basis (`grove_sheet.py`: `CoF_total = sky_revenue + Σ spread reimbursement − Σ SDE revenue`).

Spark January 2026, from the published workbook:

| Summary row | USD |
|---|---:|
| `prime_agent_revenue` | 7,503,304.56 |
| `− CoF (shown as deducted per venue)` | −7,842,258.86 |
| sum of the rows (= `summary.md` supply-side revenue) | **−338,954.30** |
| printed bold total | **−1,353,894.23** |

A reader who trusts the bold row sees a January loss about 4× the real one. April flips sign (+1,267,818.55 real vs −25,009.42 printed). All seven Spark workbooks are affected — Spark is the only prime with both non-venue revenue and a material spread — and from January through July the two figures diverge by **$7,290,483.28** in total. The gap equals PSM3 appreciation plus the spread, to the cent, every month (July: 111,594.67 + 82,524.78 = 194,119.45). The gray "sUSDS spread…" line above the block covers only the spread half, and nothing marks the bold total as a different basis.

The sum of `profit_to_grove` is a valid venue-level breakdown. The defect is presenting it as the total of the `prime_agent_revenue − CoF` rows. Related: the `grove_sheet.py` module docstring says `Σ Profit_to_Grove ≡ prime_agent_revenue`, which the module's own formula (`Σ revenue − CoF_total`) contradicts — likely how the mismatched total ended up under these rows.

**Fix:** either print `total = prime_agent_revenue − CoF` and put the sum of `profit_to_grove` on its own labelled row, or keep `total = Σ profit_to_grove` and add `− PSM3 sUSDS appreciation` and `− sUSDS spread reimbursement` as rows so the block adds up.

## 2. Summary tab — "Sky Revenue (max)" rows sum to `2 × CoF − sky_gross`

`build_settlement_xlsx.py:210`: the rows are `CoF` and `−(sky_gross − CoF)`, while the printed total is `sky_gross`. The intended relation is a deduction — `sky_gross` minus the reduction equals CoF — not a sum. Spark July 2026: rows 5,755,899.02 and −3,043,688.23 sum to 2,712,210.79 against a printed total of 8,799,587.25. The block fails to add up on 15 of the 22 workbooks that show it (Spark, Grove, Osero) and adds up only where the reduction is 0 (Obex). Display-only: it does not change the settlement, but it uses the same bold-total layout as the blocks that do sum.

**Fix:** reorder as `sky_gross → − deductions → total = CoF`.

## 3. Venues tab — "Period inflow" column contains the change in NAV, not period inflow

`build_settlement_xlsx.py:287` writes end-of-month value minus start-of-month value (commented `# period_inflow proxy`) under the header "Period inflow", although `provenance.json` already carries the true per-venue `period_inflow` (`provenance.py:91`) and `summary.md` prints it. Because `actual_revenue = change in value − period_inflow`, the column differs from the true figure by exactly the venue's booked revenue (plus any fee or adjustment) — yield therefore reads as a capital movement — and the workbook contradicts `summary.md` by ≥$1,000 on 21 of 36 workbooks. Examples: Obex July V1 −213,522,548.20 vs true −216,048,528.31 (+2,525,980.11); Grove April E9 63,724,995.01 vs 59,960,119.25 (+3,764,875.76); Spark May S32 off by +5,855,337.62.

**Fix:** write `provenance.json`'s `period_inflow` into the column — one line.

## Smaller audit-trail gaps, worth fixing in the same pass

- `summary.md`'s per-venue table has no `external_revenue` / fee / adjustment columns, so the check `actual_revenue = change in value − inflow` fails silently for those paths: Grove July E1 shows revenue 1,586,143.24 vs actual 117,961.80, with the 1,468,181.44 Merkl amount visible only in the workbook; Grove June E21 shows change in value −18,721,388.15, inflow 0.00, actual +371,738.69 (coupon booked as a cash distribution; principal movements never enter `period_inflow`); Spark S32's depositor Sky Savings Rate adjustment (July −834,617.19 vs raw mark-to-market) carries no note.
- Two headline lines are both titled "**supply-side revenue**" — the prime's (`prime_agent_revenue − CoF`) and Sky's (`CoF + SDE revenue`). Spark July prints 2,846,721.64 and 5,750,694.26 under the same label. Rename one.
- `docs/METHODOLOGY.md` §sky_savings_token still says `prime_revenue = 0`. The Case-1 L2 sUSDS venues (S37/S43/S47/S51) now book ordinary mark-to-market (S43 July actual 431,179.34).

None of the above changes what is paid. All of it changes what a third party reconstructs from the published files — and there is currently no test asserting that workbook Summary blocks add up, so the pattern can recur without anyone noticing.
