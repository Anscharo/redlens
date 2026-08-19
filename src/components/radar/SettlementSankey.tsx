import { useMemo } from "react";
import { formatUsd } from "../../lib/settlements";
import {
  collapseVenues,
  layoutVenueSankey,
  type SankeyLink,
  type SankeyNode,
  type SankeyVenue,
} from "../../lib/settlementSankey";
import { Tooltip } from "../Tooltip";

const LABEL_MAX = 26;

function linkFill(l: SankeyLink): string {
  if (l.signed < 0) return "var(--accent)";
  return l.to === "sky" ? "var(--depth-4)" : "var(--entity-delegate-org)";
}

function venueOutLines(v: SankeyVenue, primeLabel: string): string[] {
  const lines: string[] = [];
  if (Math.abs(v.profitToSky) >= 1) lines.push(`${formatUsd(v.profitToSky, true)} → Sky`);
  if (Math.abs(v.profitToGrove) >= 1) lines.push(`${formatUsd(v.profitToGrove, true)} → ${primeLabel}`);
  return lines;
}

/** Static CSS can't match "same data-venue as the hovered element" — emit one rule per id. */
function VenueHoverStyles({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  const rules = ids.map((id) => {
    const s = CSS.escape(id);
    return `
.msc-venue-pnl:has([data-venue="${s}"]:hover) [data-venue="${s}"] { opacity: 0.92; }
.msc-venue-pnl:has([data-venue="${s}"]:hover) tr[data-venue="${s}"] {
  opacity: 1;
  background: var(--row-hover);
}
.msc-venue-pnl:has([data-venue="${s}"]:hover) tr[data-venue="${s}"] td:first-child span:first-child {
  color: var(--tan);
}
.msc-venue-pnl:has([data-venue="${s}"]:hover) .msc-sankey-venue[data-venue="${s}"] .msc-sankey-node-label {
  fill: var(--tan);
}`;
  }).join("");
  return <style>{rules}</style>;
}

function SankeyLinkPath({ l }: { l: SankeyLink }) {
  return (
    <path
      className="msc-sankey-link"
      data-venue={l.from}
      d={l.path}
      fill={linkFill(l)}
    />
  );
}

function SankeyVenueNode({
  n,
  v,
  primeLabel,
}: {
  n: SankeyNode;
  v: SankeyVenue;
  primeLabel: string;
}) {
  const truncated = n.label.length > LABEL_MAX;
  const display = truncated ? `${n.label.slice(0, LABEL_MAX - 1)}…` : n.label;
  const outLines = venueOutLines(v, primeLabel);
  const labelY = n.y + n.height / 2 - (outLines.length > 1 ? 5 : 0);

  const node = (
    <g className="msc-sankey-node msc-sankey-venue" data-venue={n.id}>
      <rect x={n.x} y={n.y} width={n.width} height={n.height} fill="var(--border)" />
      <text
        x={n.x - 6}
        y={labelY}
        textAnchor="end"
        dominantBaseline="middle"
        className="mono msc-sankey-node-label"
        fill="currentColor"
        fontSize={10}
      >
        {display}
      </text>
      {outLines.map((line, i) => (
        <text
          key={line}
          x={n.x - 6}
          y={labelY + 11 + i * 10}
          textAnchor="end"
          dominantBaseline="middle"
          className="mono msc-sankey-amount"
          fontSize={9}
        >
          {line}
        </text>
      ))}
    </g>
  );

  if (!truncated) return node;
  return <Tooltip content={n.label} delay={400}>{node}</Tooltip>;
}

function SankeySinkNode({ n, total }: { n: SankeyNode; total: number }) {
  const fill = n.kind === "sky" ? "var(--depth-4)" : "var(--entity-delegate-org)";
  return (
    <g className="msc-sankey-node msc-sankey-sink">
      <rect x={n.x} y={n.y} width={n.width} height={n.height} fill={fill} />
      <text
        x={n.x + n.width + 6}
        y={n.y + n.height / 2 - 5}
        textAnchor="start"
        dominantBaseline="middle"
        className="mono msc-sankey-node-label"
        fill="currentColor"
        fontSize={10}
      >
        {n.label}
      </text>
      <text
        x={n.x + n.width + 6}
        y={n.y + n.height / 2 + 6}
        textAnchor="start"
        dominantBaseline="middle"
        className="mono msc-sankey-amount"
        fontSize={9}
        style={{ fill: total < 0 ? "var(--accent)" : undefined }}
      >
        {formatUsd(total, true)} in
      </text>
    </g>
  );
}

function SettlementSankeyView({
  rows,
  layout,
  primeLabel,
}: {
  rows: SankeyVenue[];
  layout: ReturnType<typeof layoutVenueSankey>;
  primeLabel: string;
}) {
  const byId = useMemo(() => new Map(rows.map((v) => [v.id, v])), [rows]);
  const skyTotal = useMemo(() => rows.reduce((n, v) => n + v.profitToSky, 0), [rows]);
  const primeTotal = useMemo(() => rows.reduce((n, v) => n + v.profitToGrove, 0), [rows]);

  return (
    <svg
      className="msc-sankey"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-label={`Venue flows to Sky and ${primeLabel}`}
      style={{ color: "var(--tan-2)" }}
    >
      {layout.links.map((l) => (
        <SankeyLinkPath key={`${l.from}-${l.to}`} l={l} />
      ))}
      {layout.nodes.map((n) => {
        if (n.kind === "venue") {
          const v = byId.get(n.id);
          if (!v) return null;
          return <SankeyVenueNode key={n.id} n={n} v={v} primeLabel={primeLabel} />;
        }
        const total = n.id === "sky" ? skyTotal : primeTotal;
        return <SankeySinkNode key={n.id} n={n} total={total} />;
      })}
    </svg>
  );
}

export function SettlementVenuePnl({
  venues,
  primeLabel,
}: {
  venues: SankeyVenue[];
  primeLabel: string;
}) {
  const rows = useMemo(() => collapseVenues(venues), [venues]);
  const layout = useMemo(() => layoutVenueSankey(rows, primeLabel), [rows, primeLabel]);
  const venueIds = useMemo(() => rows.map((v) => v.id), [rows]);

  if (layout.nodes.length === 0) return null;

  return (
    <div className="msc-venue-pnl">
      <VenueHoverStyles ids={venueIds} />
      <SettlementSankeyView rows={rows} layout={layout} primeLabel={primeLabel} />
      <SettlementVenueTable rows={rows} primeLabel={primeLabel} />
    </div>
  );
}

/** @deprecated Use SettlementVenuePnl for linked sankey + table hover sync. */
export function SettlementSankey({ venues, primeLabel }: { venues: SankeyVenue[]; primeLabel: string }) {
  const rows = useMemo(() => collapseVenues(venues), [venues]);
  const layout = useMemo(() => layoutVenueSankey(rows, primeLabel), [rows, primeLabel]);
  if (layout.nodes.length === 0) return null;
  return <SettlementSankeyView rows={rows} layout={layout} primeLabel={primeLabel} />;
}

export function SettlementVenueTable({
  rows: rowsProp,
  venues,
  primeLabel,
}: {
  rows?: SankeyVenue[];
  venues?: SankeyVenue[];
  primeLabel: string;
}) {
  const rows = rowsProp ?? collapseVenues(venues ?? []);
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
          <tr
            key={v.id}
            className="msc-venue-row border-t border-[var(--border)]"
            data-venue={v.id}
          >
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
