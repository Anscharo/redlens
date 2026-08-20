import { useMemo } from "react";
import { formatUsd } from "../../lib/settlements";
import {
  type SankeyLink,
  type SankeyNode,
  type SankeyVenue,
  type SankeyLayout,
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

export function SettlementSankeyView({
  rows,
  layout,
  primeLabel,
}: {
  rows: SankeyVenue[];
  layout: SankeyLayout;
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
