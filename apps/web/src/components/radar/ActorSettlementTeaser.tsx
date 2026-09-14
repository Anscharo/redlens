import { useMemo } from "react";
import { Link } from "../Link";
import { useLoaded } from "../../hooks/useAtlasData";
import { loadSettlements, reportsForPrime, formatMonth, formatUsd, grossByMonth } from "../../lib/settlements";
import { settlementsHref } from "@/lib/routes";
import { HEADER_OFFSET } from "../../lib/layout";
import { MscGrossSpark } from "./MscGrossSpark";

interface Props {
  slug: string;
  /** The Prime's display name (the chart link's accessible name). */
  name?: string;
}

/** The Monthly settlement box floated top-right of a Prime's actor page —
 *  its gross revenue across every published cycle — with a small chart
 *  beside it of that revenue month by month, split by where it went. Both
 *  are links to the Prime's settlement page. */
export function ActorSettlementTeaser({ slug, name }: Props) {
  const bundle = useLoaded(loadSettlements, { soft: true });
  const months = useMemo(() => (bundle ? grossByMonth(reportsForPrime(bundle, slug)) : []), [bundle, slug]);
  if (months.length === 0) return null;
  const href = settlementsHref(slug);
  const first = months[0];
  const last = months[months.length - 1];
  const period = months.length === 1 ? formatMonth(first.month) : `${formatMonth(first.month)} – ${formatMonth(last.month)} · ${months.length} cycles`;
  const total = months.reduce((s, m) => s + m.gross, 0);

  return (
    <div className="msc-teaser-wrap" style={{ scrollMarginTop: HEADER_OFFSET }} id="msc">
      <MscGrossSpark points={months} href={href} name={name ?? slug} />
      <Link to={href} className="msc-teaser" data-testid="msc-teaser">
        <h2 className="mono text-[10px] uppercase tracking-wider" style={{ color: "var(--tan-3)" }}>
          Monthly settlement
        </h2>
        <p className="mono text-[10px] mt-2" style={{ color: "var(--tan-3)" }}>
          {period}
        </p>
        <p className="mono text-lg leading-tight mt-1" style={{ color: "var(--tan)" }}>
          {formatUsd(total, true)}
        </p>
        <p className="mono text-[10px]" style={{ color: "var(--tan-2)" }}>
          gross revenue
        </p>
        <p className="text-[10px] mt-1" style={{ color: "var(--tan-3)" }}>
          OEA calculation, not the on-chain GovOps spell
        </p>
        <span className="msc-teaser-link mono text-[10px] text-accent">
          full cycle <span className="enlargen">→</span>
        </span>
      </Link>
    </div>
  );
}
