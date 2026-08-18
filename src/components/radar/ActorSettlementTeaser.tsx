import { useMemo } from "react";
import { Link } from "../Link";
import { useLoaded } from "../../hooks/useAtlasData";
import { loadSettlements, reportsForPrime, formatMonth, formatUsd } from "../../lib/settlements";
import { settlementsHref } from "../../lib/routes";
import { HEADER_OFFSET } from "../../lib/layout";

interface Props {
  slug: string;
}

export function ActorSettlementTeaser({ slug }: Props) {
  const bundle = useLoaded(loadSettlements, { soft: true });
  const latest = useMemo(() => {
    if (!bundle) return null;
    const rows = reportsForPrime(bundle, slug);
    return rows[rows.length - 1] ?? null;
  }, [bundle, slug]);
  if (!latest) return null;

  return (
    <section
      id="msc"
      className="msc-teaser"
      data-testid="msc-teaser"
      style={{ scrollMarginTop: HEADER_OFFSET }}
    >
      <h2 className="mono text-[10px] uppercase tracking-wider" style={{ color: "var(--tan-3)" }}>
        Monthly settlement
      </h2>
      <p className="mono text-[10px] mt-2" style={{ color: "var(--tan-3)" }}>
        {formatMonth(latest.month)}
      </p>
      <p className="mono text-lg" style={{ color: "var(--tan)" }}>
        {formatUsd(latest.headline.skyRevenue)} to Sky
      </p>
      <Link
        to={settlementsHref(slug)}
        className="msc-teaser-link mono text-[10px] text-accent hover:underline"
      >
        full cycle <span className="enlargen">→</span>
      </Link>
    </section>
  );
}
