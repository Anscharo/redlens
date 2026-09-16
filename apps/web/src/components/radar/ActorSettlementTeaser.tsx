import { useMemo, type CSSProperties } from "react";
import { Link } from "../Link";
import { useLoaded } from "../../hooks/useAtlasData";
import {
  loadSettlements,
  reportsForPrime,
  formatMonth,
  formatUsd,
  summaryThreeWay,
  cycleTotals,
  leadCycleTotal,
  cycleWindow,
} from "../../lib/settlements";
import { settlementsHref } from "@/lib/routes";
import { HEADER_OFFSET } from "../../lib/layout";
import { textWidth } from "../../lib/textWidth";
import { MscCycleSpark, SERIES, CHART_W } from "./MscCycleSpark";

// The card sizes itself to its own text. There is spare width beside it on
// an actor page, and growing taller pushes the page's content down, so each
// semantic line below gets the room to stay on ONE rendered line — measured
// with pretext rather than guessed, the same rule the MSC charts follow for
// their gutters. Floors keep a short month from shrinking the card; ceilings
// keep one long line from running it off the page.
const mono = (px: number) => `${px}px 'Source Code Pro', 'Courier New', monospace`;
const MONO_10 = mono(10);
const MONO_18 = mono(18);
const INTER_10 = "10px 'Inter', system-ui, sans-serif";
const MONO_10_CH = 6;
const MONO_18_CH = 10.8;
const INTER_10_CH = 4.7;
/** .msc-teaser's left + right padding, plus a hair so nothing touches. */
const FIG_PAD = 30;
const FIG_MIN = 208;
const FIG_MAX = 400;
/** Tracking-wider on the heading, which pretext measures without. */
const TRACKING = 0.05 * 10;
/** .msc-teaser-chart's padding, and the gap between legend items. */
const CHART_PAD = 22;
const LEGEND_GAP = 12;
/** A legend swatch (w-2) and its mr-1. */
const SWATCH = 12;
/** One string, so the line and its measurement cannot drift apart. */
const DISCLAIMER = "OEA calculation, not the on-chain GovOps spell";

/** Width of the legend on one line — the chart half can be no narrower. */
const LEGEND_W =
  SERIES.reduce((n, s) => n + SWATCH + textWidth(s.label, MONO_10, MONO_10_CH), 0) +
  LEGEND_GAP * (SERIES.length - 1) +
  CHART_PAD;

interface Props {
  slug: string;
  /** The Prime's display name (the card link's accessible name). */
  name?: string;
}

/** One running total on the card. The lead gets the big type; the other two
 *  sit under it at one smaller size, so none of the three reads as the sum
 *  of the others. A negative total is the loss red the charts stripe. */
function Total({ amount, label, lead }: { amount: number; label: string; lead?: boolean }) {
  const ink = amount < 0 ? "var(--msc-loss)" : lead ? "var(--tan)" : "var(--tan-2)";
  if (lead) {
    return (
      <>
        <p className="mono text-lg leading-tight mt-1" style={{ color: ink }}>
          {formatUsd(amount, true)}
        </p>
        <p className="mono text-[10px]" style={{ color: "var(--tan-2)" }}>
          {label}
        </p>
      </>
    );
  }
  return (
    <p className="mono text-[10px] mt-0.5" style={{ color: "var(--tan-3)" }}>
      <span style={{ color: ink }}>{formatUsd(amount, true)}</span> {label}
    </p>
  );
}

/** The Monthly settlement card floated top-right of a Prime's actor page:
 *  the trailing year of cycles as three SEPARATE running totals, and beside
 *  them the same clustered month-by-month chart its settlement page leads
 *  with. The whole card is ONE link to that page, so hovering either half
 *  lights the card as a unit.
 *
 *  The three totals are never added. What a Prime owes Sky and what Sky
 *  owes the Prime settle as two amounts in opposite directions
 *  (A.2.4.1.2.2.1.1.2 and A.2.4.1.2.2.1.1.1), and the Atlas defines no term
 *  for their sum — which is why the old single "gross revenue" figure and
 *  its stacked chart are gone. */
export function ActorSettlementTeaser({ slug, name }: Props) {
  const bundle = useLoaded(loadSettlements, { soft: true });
  const rows = useMemo(
    () => (bundle ? cycleWindow(reportsForPrime(bundle, slug)).rows : []),
    [bundle, slug],
  );
  if (rows.length === 0) return null;
  const n = rows.length;
  const months = rows.map(summaryThreeWay);
  const totals = cycleTotals(rows);
  const lead = leadCycleTotal(totals);
  const rest = [
    { amount: totals.kept, label: "supply-side kept" },
    { amount: totals.demand, label: "demand-side from Sky" },
    { amount: totals.sky, label: "to Sky" },
  ].filter((r) => r.label !== lead.label);
  const period =
    n === 1
      ? formatMonth(months[0].month)
      : `${formatMonth(months[0].month)} – ${formatMonth(months[n - 1].month)} · ${n} cycles`;

  // Every line of the figures half, at the size it actually renders.
  const figuresW = Math.min(
    FIG_MAX,
    Math.max(
      FIG_MIN,
      Math.round(
        FIG_PAD +
          Math.max(
            textWidth("MONTHLY SETTLEMENT", MONO_10, MONO_10_CH) + TRACKING * "MONTHLY SETTLEMENT".length,
            textWidth(period, MONO_10, MONO_10_CH),
            textWidth(formatUsd(lead.amount, true), MONO_18, MONO_18_CH),
            textWidth(lead.label, MONO_10, MONO_10_CH),
            ...rest.map((r) => textWidth(`${formatUsd(r.amount, true)} ${r.label}`, MONO_10, MONO_10_CH)),
            textWidth(DISCLAIMER, INTER_10, INTER_10_CH),
            textWidth("full cycle →", MONO_10, MONO_10_CH),
          ),
      ),
    ),
  );

  return (
    <Link
      to={settlementsHref(slug)}
      className="msc-teaser-wrap"
      style={
        {
          scrollMarginTop: HEADER_OFFSET,
          // Custom properties, not `width`, so the narrow breakpoint's
          // `width: 100%` still wins and the halves stack on a phone.
          "--msc-teaser-w": `${figuresW}px`,
          "--msc-teaser-chart-w": `${Math.round(Math.max(LEGEND_W, CHART_W + CHART_PAD))}px`,
        } as CSSProperties
      }
      id="msc"
      data-testid="msc-teaser"
      aria-label={`${name ?? slug} over ${n} ${n === 1 ? "cycle" : "cycles"}: ${formatUsd(totals.sky, true)} to Sky, ${formatUsd(totals.kept, true)} supply-side kept, ${formatUsd(totals.demand, true)} demand-side from Sky — open the settlement charts`}
    >
      <div className="msc-teaser">
        <h2 className="mono text-[10px] uppercase tracking-wider" style={{ color: "var(--tan-3)" }}>
          Monthly settlement
        </h2>
        <p className="mono text-[10px] mt-2" style={{ color: "var(--tan-3)" }}>
          {period}
        </p>
        <Total amount={lead.amount} label={lead.label} lead />
        {rest.map((r) => (
          <Total key={r.label} amount={r.amount} label={r.label} />
        ))}
        <p className="text-[10px] mt-1" style={{ color: "var(--tan-3)" }}>
          {DISCLAIMER}
        </p>
        <span className="msc-teaser-link mono text-[10px] text-accent">
          full cycle <span className="enlargen">→</span>
        </span>
      </div>
      <MscCycleSpark points={months} />
    </Link>
  );
}
