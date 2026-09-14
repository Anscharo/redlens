import { useMemo } from "react";
import { Link } from "../Link";
import { useLoaded } from "../../hooks/useAtlasData";
import { loadSettlements, reportsForPrime, formatMonth, formatUsd, teaserFigure, cumulativeToSky } from "../../lib/settlements";
import { settlementsHref } from "@/lib/routes";
import { HEADER_OFFSET } from "../../lib/layout";
import { MscCumulativeSpark } from "./MscCumulativeSpark";

interface Props {
  slug: string;
  /** The Prime's display name (the chart link's accessible name). */
  name?: string;
}

/** The Monthly settlement box floated top-right of a Prime's actor page,
 *  with a small cumulative To-Sky chart beside it. Both are links to the
 *  Prime's settlement page. A Prime that has sent Sky nothing (Keel: all
 *  demand-side) gets the box alone, showing its latest month. */
export function ActorSettlementTeaser({ slug, name }: Props) {
  const bundle = useLoaded(loadSettlements, { soft: true });
  const data = useMemo(() => {
    if (!bundle) return null;
    const rows = reportsForPrime(bundle, slug);
    const latest = rows[rows.length - 1];
    return latest ? { latest, cum: cumulativeToSky(rows) } : null;
  }, [bundle, slug]);
  if (!data) return null;
  const { latest, cum } = data;
  const href = settlementsHref(slug);
  const cumulative = cum.length > 0;
  const period = cumulative
    ? cum.length === 1
      ? formatMonth(cum[0].month)
      : `${formatMonth(cum[0].month)} – ${formatMonth(latest.month)} · ${cum.length} cycles`
    : formatMonth(latest.month);
  const figure = cumulative
    ? `${formatUsd(cum[cum.length - 1].cumulative)} to Sky`
    : `${formatUsd(teaserFigure(latest).amount)} ${teaserFigure(latest).suffix}`;

  return (
    <div className="msc-teaser-wrap" style={{ scrollMarginTop: HEADER_OFFSET }} id="msc">
      {cumulative && <MscCumulativeSpark points={cum} href={href} name={name ?? slug} />}
      <Link to={href} className="msc-teaser" data-testid="msc-teaser">
        <h2 className="mono text-[10px] uppercase tracking-wider" style={{ color: "var(--tan-3)" }}>
          Monthly settlement
        </h2>
        <p className="mono text-[10px] mt-2" style={{ color: "var(--tan-3)" }}>
          {period}
        </p>
        <p className="mono text-lg" style={{ color: "var(--tan)" }}>
          {figure}
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
