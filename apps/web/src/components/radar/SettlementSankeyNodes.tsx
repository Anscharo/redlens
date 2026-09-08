import { formatUsd } from "../../lib/settlements";
import type { SankeyNode, SankeyVenue } from "../../lib/settlementSankey";
import { Tooltip } from "../Tooltip";
import { SvgRouteLink } from "./SvgRouteLink";

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
  return <Tooltip content={n.label}>{node}</Tooltip>;
}

/**
 * One sink bar. A sink with losses gets TWO of these — what came in and what
 * went back out — so the figure beside each bar is that bar's own gross, and
 * the pair adds up the way the venue column does. `gross` is signed for the
 * out-bar. `netted` marks an in-bar whose sink also has an out-bar, where the
 * distinction between gross and net is the thing worth spelling out — and
 * where the out-bar carries `net`, the figure the two bars settle to.
 */
export function SankeySinkNode({
  n,
  gross,
  netted,
  net,
  skyTo,
  fill,
}: {
  n: SankeyNode;
  gross: number;
  netted: boolean;
  net?: number;
  /** When set on the Sky in-bar, its label links to the /radar MSC overview. */
  skyTo?: string;
  /** The bar's paint: Sky's blue or the Prime's identity color for an
   *  in-bar; the striped pattern of the same color for an out-bar. */
  fill: string;
}) {
  const out = n.flow === "out";
  const figure = out
    ? `−${formatUsd(gross, true)} out`
    : `${formatUsd(gross, true)}${netted ? " gross" : ""} in`;
  const label = !out && (
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
  );

  return (
    <g className="msc-sankey-node msc-sankey-sink">
      <rect x={n.x} y={n.y} width={n.width} height={n.height} fill={fill} />
      {label && skyTo && n.kind === "sky" ? (
        <SvgRouteLink
          to={skyTo}
          className="msc-sankey-sink-link"
          label="Open this month in the ecosystem Monthly Settlement Cycle overview"
        >
          {label}
        </SvgRouteLink>
      ) : (
        label
      )}
      <text
        x={n.x + n.width + 6}
        y={out ? n.labelY : n.labelY + 6}
        textAnchor="start"
        dominantBaseline="middle"
        className="mono msc-sankey-amount msc-sankey-sink-total"
        fontSize={9}
        style={out ? { fill: "var(--accent)" } : undefined}
      >
        {figure}
      </text>
      {out && net !== undefined && (
        <text
          x={n.x + n.width + 6}
          y={n.labelY + 11}
          textAnchor="start"
          dominantBaseline="middle"
          className="mono msc-sankey-amount msc-sankey-sink-net"
          fontSize={9}
          style={{ fill: net < 0 ? "var(--accent)" : "var(--tan-2)" }}
        >
          net {formatUsd(net, true)}
        </text>
      )}
    </g>
  );
}
