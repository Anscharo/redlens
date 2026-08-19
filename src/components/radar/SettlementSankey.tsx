import { useMemo } from "react";
import { formatUsd } from "../../lib/settlements";
import { collapseVenues, layoutVenueSankey, type SankeyVenue } from "../../lib/settlementSankey";

export function SettlementSankey({ venues, primeLabel }: { venues: SankeyVenue[]; primeLabel: string }) {
  const collapsed = useMemo(() => collapseVenues(venues), [venues]);
  const layout = useMemo(
    () => layoutVenueSankey(collapsed, primeLabel),
    [collapsed, primeLabel],
  );
  if (layout.nodes.length === 0) return null;

  return (
    <svg
      className="msc-sankey"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-label={`Venue flows to Sky and ${primeLabel}`}
      style={{ color: "var(--tan-2)" }}
    >
      {layout.links.map((l) => (
        <path
          key={`${l.from}-${l.to}`}
          className="msc-sankey-link"
          d={l.path}
          fill={
            l.signed < 0
              ? "var(--accent)"
              : l.to === "sky"
                ? "var(--depth-4)"
                : "var(--entity-delegate-org)"
          }
        >
          <title>{`${l.from} → ${l.to === "sky" ? "Sky" : primeLabel}: ${formatUsd(l.signed)}`}</title>
        </path>
      ))}
      {layout.nodes.map((n) => (
        <g key={n.id}>
          <rect
            x={n.x}
            y={n.y}
            width={n.width}
            height={n.height}
            fill={n.kind === "sky" ? "var(--depth-4)" : n.kind === "prime" ? "var(--entity-delegate-org)" : "var(--border)"}
          />
          <text
            x={n.kind === "venue" ? n.x - 6 : n.x + n.width + 6}
            y={n.y + n.height / 2}
            textAnchor={n.kind === "venue" ? "end" : "start"}
            dominantBaseline="middle"
            className="mono"
            fill="currentColor"
            fontSize={10}
          >
            {n.label.length > 26 ? `${n.label.slice(0, 25)}…` : n.label}
            <title>{n.label}</title>
          </text>
        </g>
      ))}
    </svg>
  );
}

export function SettlementVenueTable({
  venues,
  primeLabel,
}: {
  venues: SankeyVenue[];
  primeLabel: string;
}) {
  const rows = collapseVenues(venues);
  if (rows.length === 0) return null;
  return (
    <table className="w-full text-sm border-collapse mt-4">
      <thead>
        <tr className="mono text-[10px] uppercase tracking-wider" style={{ color: "var(--tan-3)" }}>
          <th className="text-left font-normal pb-1">Venue</th>
          <th className="text-right font-normal pb-1">To Sky</th>
          <th className="text-right font-normal pb-1">To {primeLabel}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((v) => (
          <tr key={v.id} className="border-t border-[var(--border)]">
            <td className="py-1 pr-3">
              <span style={{ color: "var(--tan-2)" }}>{v.label}</span>
              {v.synthetic && (
                <span className="mono text-[10px] ml-2" style={{ color: "var(--tan-3)" }}>
                  synthetic
                </span>
              )}
            </td>
            <td
              className="py-1 text-right mono text-[11px]"
              style={{ color: v.profitToSky < 0 ? "var(--accent)" : "var(--tan-2)" }}
            >
              {formatUsd(v.profitToSky)}
            </td>
            <td
              className="py-1 text-right mono text-[11px]"
              style={{ color: v.profitToGrove < 0 ? "var(--accent)" : "var(--tan-2)" }}
            >
              {formatUsd(v.profitToGrove)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
