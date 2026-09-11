import { formatUsd } from "../../lib/settlements";
import { AGENT_W, type FlowAgent, type FlowLink } from "../../lib/mscFlowLayout";
import { SvgRouteLink } from "./SvgRouteLink";
import { markId, SLICE_CODE } from "./MscRingPills";
import { primeLinkLabel, type OverviewPrime } from "./MscRingPrime";

/** A ribbon's permanent figure, in the ribbon's own ink — only where the
 *  layout found it fits. */
function LinkFigure({ l }: { l: FlowLink }) {
  if (l.figureX == null || l.figureY == null) return null;
  return (
    <text x={l.figureX} y={l.figureY + 12} textAnchor="middle" fontSize={34} className="msc-ring-figure mono" data-kind={l.kind}>
      {SLICE_CODE[l.kind]} {formatUsd(l.value, true)}
    </text>
  );
}

/** One Prime on the flow chart: its bar in its identity color, the ribbons
 *  feeding it (one mark per line item, the same marks the orbital pie's
 *  slices are), its To-Sky ribbons (one mark — the orbit's arrow), and its
 *  name + gross above the bar. What it kept stops at the bar; a loss is a
 *  line on the gross pill, not a mark. */
export function FlowAgentGroup({ agent, flow, label, bandColor, to, month }: OverviewPrime & { agent: FlowAgent; month: string }) {
  const p = agent.prime;
  const group = (
    <g className="msc-ring-prime" data-prime={p}>
      {agent.inbound.map((l) => (
        <g key={l.kind} className="msc-ring-mark" data-mark={markId(p, l.kind)}>
          <path d={l.path} className={`msc-ring-slice msc-ring-${l.kind}`} />
        </g>
      ))}
      {agent.outbound.length > 0 && (
        <g className="msc-ring-mark" data-mark={markId(p, "sky")}>
          {agent.outbound.map((l) => (
            <path
              key={l.kind}
              d={l.path}
              className={`msc-ring-arrow msc-ring-${l.kind}`}
              data-cof={l.kind === "cof" ? "true" : undefined}
              data-sde={l.kind === "sde" ? "true" : undefined}
            />
          ))}
        </g>
      )}
      <rect x={agent.x} y={agent.y} width={AGENT_W} height={agent.h} className="msc-flow-agent" style={{ fill: bandColor }} />
      {agent.inbound.map((l) => (
        <LinkFigure key={`in-${l.kind}`} l={l} />
      ))}
      {agent.outbound.map((l) => (
        <LinkFigure key={`out-${l.kind}`} l={l} />
      ))}
      <g className="msc-ring-mark" data-mark={markId(p, "gross")}>
        <text x={agent.labelX} y={agent.labelY} textAnchor="middle" fontSize={42} className="msc-ring-label msc-flow-halo">
          {label}
        </text>
        <text x={agent.labelX} y={agent.labelY + 34} textAnchor="middle" fontSize={28} className="msc-ring-sublabel mono msc-flow-halo">
          {formatUsd(agent.gross, true)}
        </text>
      </g>
    </g>
  );
  if (!to) return group;
  return (
    <SvgRouteLink to={to} label={primeLinkLabel(flow, label, month, agent.share)}>
      {group}
    </SvgRouteLink>
  );
}
