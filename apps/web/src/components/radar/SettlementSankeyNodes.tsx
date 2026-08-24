import { formatUsd } from "../../lib/settlements";
import type { SankeyNode, SankeyVenue } from "../../lib/settlementSankey";
import { Tooltip } from "../Tooltip";

const LABEL_MAX = 30;

function venueOutLines(v: SankeyVenue, primeLabel: string): string[] {
  const lines: string[] = [];
  if (Math.abs(v.profitToSky) >= 1) lines.push(`${formatUsd(v.profitToSky, true)} → Sky`);
  if (Math.abs(v.profitToGrove) >= 1) lines.push(`${formatUsd(v.profitToGrove, true)} → ${primeLabel}`);
  return lines;
}

/**
 * Venue name in the left gutter; its two figures ride ON the flows and appear
 * only on hover. Printing them always is what made the left column collide once
 * the chart was short enough to sit on screen with the table — and the table
 * below already carries the exact numbers.
 */
export function SankeyVenueNode({
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
  // Anchored to the node, not to labelY: these point at the ribbons leaving it.
  const amountY = n.y + n.height / 2 - (outLines.length > 1 ? 5 : 0);

  const node = (
    <g className="msc-sankey-node msc-sankey-venue" data-venue={n.id}>
      <rect x={n.x} y={n.y} width={n.width} height={n.height} fill="var(--border)" />
      <text
        x={n.x - 6}
        y={n.labelY}
        textAnchor="end"
        dominantBaseline="middle"
        className="mono msc-sankey-node-label"
        fill="currentColor"
        fontSize={10}
      >
        {display}
      </text>
      <g className="msc-sankey-amounts">
        {outLines.map((line, i) => (
          <text
            key={line}
            x={n.x + n.width + 8}
            y={amountY + i * 11}
            textAnchor="start"
            dominantBaseline="middle"
            className="mono msc-sankey-amount"
            fontSize={9}
          >
            {line}
          </text>
        ))}
      </g>
    </g>
  );

  if (!truncated) return node;
  return <Tooltip content={n.label} delay={400}>{node}</Tooltip>;
}

export function SankeySinkNode({ n, total }: { n: SankeyNode; total: number }) {
  const fill = n.kind === "sky" ? "var(--depth-4)" : "var(--entity-delegate-org)";
  return (
    <g className="msc-sankey-node msc-sankey-sink">
      <rect x={n.x} y={n.y} width={n.width} height={n.height} fill={fill} />
      <text
        x={n.x + n.width + 6}
        y={n.labelY - 5}
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
        y={n.labelY + 6}
        textAnchor="start"
        dominantBaseline="middle"
        className="mono msc-sankey-amount msc-sankey-sink-total"
        fontSize={9}
        style={{ fill: total < 0 ? "var(--accent)" : undefined }}
      >
        {formatUsd(total, true)} in
      </text>
    </g>
  );
}
