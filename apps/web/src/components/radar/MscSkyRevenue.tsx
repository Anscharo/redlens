import { formatMonth, formatUsd, formatUsdShort } from "../../lib/settlements";
import type { SkyIncomeExpense } from "@/lib/skyNetRevenue";
import { SETTLEMENT_CITATIONS } from "@/lib/settlementCitations";
import { atlasHref } from "@/lib/routes";
import { AtlasLink } from "../AtlasLink";
import { Tooltip } from "../Tooltip";

// Sky's own month, Sky-wide: Income, Expenses and Net Revenue side by side
// per month (skyNetRevenue.ts). It sits apart from the To-Sky bars because
// Net Revenue is not a share of those bars: it is all of Sky's income, MSC
// and non-MSC, less everything Sky spent, including what it paid Primes.
const BAR_W = 34;
const BAR_GAP = 4;
const GROUP_GAP = 28;
const CHART_H = 150;
const LABEL_H = 14;

const SERIES = [
  { key: "income", cite: SETTLEMENT_CITATIONS.income, cls: "msc-skyrev-income" },
  { key: "expenses", cite: SETTLEMENT_CITATIONS.expenses, cls: "msc-skyrev-expenses" },
  { key: "net", cite: SETTLEMENT_CITATIONS.netRevenue, cls: "msc-skyrev-net" },
] as const;

/** Corrections under this are rounding, not a prior-cycle correction. */
const CORRECTION_NOTE_FROM = 1_000;

/** Why the panel starts where it does (skyNetRevenue.ts). */
const BASIS_NOTE =
  "From Soter Labs' consolidated sky_total report. The Atlas counts each settlement cycle in the month the cycle covers (A.2.3.1.2.1). Soter's reports do that from July 2026. Before then they counted each cycle in the month it was paid, one month later, and booked part of it with other expenses, so those months can't be re-dated cleanly. June's cycle was paid in July, as the basis changed, so no report counts it in June.";

export function MscSkyRevenue({ months }: { months: SkyIncomeExpense[] }) {
  if (!months.length) return null;
  const peak = Math.max(1, ...months.flatMap((m) => [m.income, m.expenses, Math.abs(m.net)]));
  const groupW = SERIES.length * BAR_W + (SERIES.length - 1) * BAR_GAP;
  const width = months.length * groupW + (months.length - 1) * GROUP_GAP;
  const h = (v: number) => (Math.max(0, v) / peak) * (CHART_H - LABEL_H);
  const corrected = months.filter((m) => Math.abs(m.corrections) >= CORRECTION_NOTE_FROM);
  return (
    <section aria-label="Sky's Income, Expenses and Net Revenue by month">
      <p className="text-sm mb-2" style={{ color: "var(--tan)" }}>
        Sky's month: Income, Expenses and Net Revenue
        <Tooltip content={BASIS_NOTE}>
          <button type="button" className="msc-ts-netrev-note" aria-label="Why these figures start in July 2026">*</button>
        </Tooltip>
      </p>
      <p className="mono text-[10px] flex flex-wrap gap-x-4 gap-y-1 mb-2" style={{ color: "var(--tan-3)" }}>
        {SERIES.map((s) => (
          <span key={s.key}>
            <svg width={8} height={8} className="inline-block mr-1 align-middle" aria-hidden="true"><rect width={8} height={8} className={s.cls} /></svg>
            <AtlasLink to={atlasHref(s.cite.uuid)} className="msc-ring-caption-link">{s.cite.term}</AtlasLink>
          </span>
        ))}
      </p>
      <p className="mono text-[9px] m-0" style={{ color: "var(--tan-3)" }}>USD / month</p>
      <div style={{ maxWidth: "100%", overflowX: "auto" }}>
        <svg width={width} height={CHART_H + 18} className="msc-skyrev" role="img"
          aria-label={months.map((m) => `${formatMonth(m.month)}: Income ${formatUsd(m.income)}, Expenses ${formatUsd(m.expenses)}, Net Revenue ${formatUsd(m.net)}`).join("; ")}>
          {months.map((m, i) => {
            const x0 = i * (groupW + GROUP_GAP);
            return (
              <g key={m.month}>
                {SERIES.map((s, k) => {
                  const v = m[s.key];
                  const x = x0 + k * (BAR_W + BAR_GAP);
                  return (
                    <g key={s.key}>
                      <rect x={x} y={CHART_H - h(v)} width={BAR_W} height={h(v)} className={s.cls}>
                        <title>{`${s.cite.term} · ${formatMonth(m.month)} · ${formatUsd(v)}`}</title>
                      </rect>
                      <text x={x + BAR_W / 2} y={CHART_H - h(v) - 3} textAnchor="middle" fontSize={9} className="mono msc-ts-axis">
                        {formatUsdShort(v, 100_000)}
                      </text>
                    </g>
                  );
                })}
                <text x={x0 + groupW / 2} y={CHART_H + 13} textAnchor="middle" fontSize={10} className="mono msc-ts-axis">{formatMonth(m.month)}</text>
              </g>
            );
          })}
          <line x1={0} x2={width} y1={CHART_H} y2={CHART_H} stroke="var(--border)" strokeWidth={1} />
        </svg>
      </div>
      {corrected.length > 0 && (
        <ul className="mono text-[10px] mt-2 m-0 p-0 list-none" style={{ color: "var(--tan-3)" }}>
          {corrected.map((m) => (
            <li key={m.month}>
              {formatMonth(m.month)} Income includes {formatUsdShort(m.corrections, 10_000)} of prior-cycle corrections settled with this cycle.
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
