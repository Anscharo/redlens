import { useMemo } from "react";
import { Link } from "../Link";
import { useLoaded } from "../../hooks/useAtlasData";
import { loadSettlements, reportsForPrime, formatMonth, formatUsd, grossByMonth } from "../../lib/settlements";
import { settlementsHref } from "@/lib/routes";
import { HEADER_OFFSET } from "../../lib/layout";
import { MscGrossSpark } from "./MscGrossSpark";

interface Props {
  slug: string;
  /** The Prime's display name (the card link's accessible name). */
  name?: string;
}

/** The Monthly settlement card floated top-right of a Prime's actor page:
 *  its total gross revenue across every published cycle, and to the right
 *  a small chart of that revenue month by month, split by where it went.
 *  The whole card is ONE link to the Prime's settlement page, so hovering
 *  either half lights the card as a unit. */
export function ActorSettlementTeaser({ slug, name }: Props) {
  const bundle = useLoaded(loadSettlements, { soft: true });
  const months = useMemo(() => (bundle ? grossByMonth(reportsForPrime(bundle, slug)) : []), [bundle, slug]);
  if (months.length === 0) return null;
  const n = months.length;
  const first = months[0];
  const last = months[n - 1];
  const period = n === 1 ? formatMonth(first.month) : `${formatMonth(first.month)} – ${formatMonth(last.month)} · ${n} cycles`;
  const total = months.reduce((s, m) => s + m.gross, 0);

  return (
    <Link
      to={settlementsHref(slug)}
      className="msc-teaser-wrap"
      style={{ scrollMarginTop: HEADER_OFFSET }}
      id="msc"
      data-testid="msc-teaser"
      aria-label={`${name ?? slug}: ${formatUsd(total, true)} total gross revenue over ${n} ${n === 1 ? "cycle" : "cycles"} — open the settlement charts`}
    >
      <div className="msc-teaser">
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
          total gross revenue
        </p>
        <p className="text-[10px] mt-1" style={{ color: "var(--tan-3)" }}>
          OEA calculation, not the on-chain GovOps spell
        </p>
        <span className="msc-teaser-link mono text-[10px] text-accent">
          full cycle <span className="enlargen">→</span>
        </span>
      </div>
      <MscGrossSpark points={months} />
    </Link>
  );
}
