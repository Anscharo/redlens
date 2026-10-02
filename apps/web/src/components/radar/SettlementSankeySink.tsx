// The sankey's right-hand bars, split from the venue column (one file,
// one node kind) — they share no helpers, only the chart that draws both.
import { formatUsd } from "../../lib/settlements";
import type { SankeyNode } from "../../lib/settlementSankey";
import { SvgRouteLink } from "./SvgRouteLink";

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
        style={out ? { fill: "var(--msc-loss)" } : undefined}
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
          style={{ fill: net < 0 ? "var(--msc-loss)" : "var(--tan-2)" }}
        >
          net {formatUsd(net, true)}
        </text>
      )}
    </g>
  );
}
