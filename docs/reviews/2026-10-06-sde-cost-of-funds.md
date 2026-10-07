# Cost of funds and Sky Direct Exposure: no double charge

**Question.** A chart audit asked whether Soter's cost of funds charges a Prime the borrow rate on the USDS that finances its Sky Direct Exposure (SDE) and, on top of that, sends Sky the SDE yield. That would count the same funding twice.

The 2026-08-20 upstream one-pager left this open: its "Not assessed" paragraph asks whether `CoF = sky_revenue − sde_revenue` matches the Atlas's interest base.

**Answer: it does not double count.** The pipeline deducts the SDE balance from utilized USDS before applying the borrow rate, exactly as the Atlas prescribes. Every published workbook was generated with that code.

## What the Atlas says

- Interest is charged on utilized USDS, defined as borrowed liquidity less five deductions. One of them is "USDS attributable to a Sky Direct Exposure". Calculation Of Applicable Balance, A.2.4.2.1.2 (`adbe704f-9c50-4ee1-b632-398cdd87598a`).
- On SDE, Primes "are not required to pay the Agent Credit Line Borrow Rate with respect to funds borrowed to finance Sky Direct Exposures". All yield on Sky Direct Exposures is "due exclusively to Sky", "implemented as an adjustment to the Monthly Settlement Cycle". Revenue Sharing For Sky Direct Exposures, A.2.2.10.1.1.1.1.5 (`07e0f716-ce23-4394-a5f4-bee537713f48`).

## What the pipeline does

All references are to `soterlabs/settlement-cycle` at `4860a40`.

- **The SDE balance is deducted.** `src/settle/compute/sky_revenue.py`, lines 299–306:

  ```
  utilized = cum_debt − cum_alm_usds − cum_psm_usds_leg − cum_sde − cum_curve_usds − cum_lending_idle − cum_basin_idle
  ```

  Here `cum_sde` is the daily SDE asset value, plus the USDC leg of the PSM3. The function's docstring says so explicitly: "returns BR on (utilized − SDE asset value); the caller composes it with sde_revenue to form gross sky_revenue".
- **The SDE yield is added back separately.** `sde_revenue` is the realised SDE yield: `Σ actual_rev × sd_share` (`monthly_pnl.py`, about line 2118). So:

  ```
  sky_revenue = BR × (utilized − SDE) + sde_revenue
  cof         = sky_revenue − sde_revenue = BR × (utilized − SDE)
  ```

  This matches A.2.4.2.1.2 and A.2.2.10.1.1.1.1.5. The Prime pays nothing on SDE funding, and Sky receives the realised SDE yield.
- **When the deduction arrived.** `cum_sde` entered `sky_revenue.py` in `30a3028` (2026-05-04). Every published Grove and Spark workbook was generated on or after 2026-07-31 (`generatedAt` in `public/settlements.json`), so all of them include the deduction.

## Consistency check on the published figures

- **Grove.** Its cost of funds stays at $2.95–3.75M a month while its SDE balance (JTRSY plus BUIDL) swings between $0.43B and $2.21B.
  - Measured against Grove's non-SDE venue balances, the implied annual rate is 2.8–5.1%.
  - Measured against all of Grove's balances, it is 1.1–1.9% (3.4% in September, when the SDE balance dropped).
- **Obex** has no SDE and runs at 100% utilisation, and implies 3.6–5.2%.

So Grove's cost of funds tracks its non-SDE balances at about the borrow rate. On its own this check does not separate the two readings, because SDE yield is close to the borrow rate. The code above is what settles it.

## Consequences

- **Allocation.** Pure-SDE venues carry `cofAlloc = 0` in the workbooks, consistent with the above. A venue that is partly SDE (Grove's JAAA) carries cost of funds on its Prime-held part only.
- **Settlement skill.** `.claude/skills/settlement-reports/SKILL.md` had a stale `utilized` formula without the SDE term. It is corrected in the same change as this note.
- **SAbR code.** Nothing changes. `atlasAmountDue` (`src/lib/settlementAtlasCheck.ts`) already treats a venue's workbook cost of funds as its Instance Expense. That is the borrow-rate charge on the venue's share of utilized USDS, which excludes SDE.
