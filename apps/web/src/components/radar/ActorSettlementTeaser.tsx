import { useMemo } from "react";
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
import { MscCycleSpark } from "./MscCycleSpark";

/** One string, so the rendered line and any copy edit stay in one place. */
const DISCLAIMER = "OEA calculation, not the on-chain GovOps spell";

export interface ActorSettlementTeaserProps {
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
      <p className="msc-teaser-lead mono text-lg leading-tight mt-1" style={{ color: ink }}>
        {formatUsd(amount, true)}{" "}
        <span className="text-[10px]" style={{ color: "var(--tan-2)" }}>
          {label}
        </span>
      </p>
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
export function ActorSettlementTeaser({ slug, name }: ActorSettlementTeaserProps) {
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

  return (
    <Link
      to={settlementsHref(slug)}
      className="msc-teaser-wrap"
      style={{ scrollMarginTop: HEADER_OFFSET }}
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
