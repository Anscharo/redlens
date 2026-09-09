import { formatUsd } from "../../lib/settlements";
import { NODE_W, type FlowAgent, type FlowLink } from "../../lib/mscFlowLayout";
import { SvgRouteLink } from "./SvgRouteLink";
import { markId, SLICE_CODE } from "./MscRingPills";
import { primeLinkLabel, type OverviewPrime } from "./MscRingPrime";

/** A ribbon's permanent figure, in the ribbon's own ink — only where the
 *  layout found it fits. */
function LinkFigure({ l }: { l: FlowLink }) {
  if (l.figureX == null || l.figureY == null) return null;
  return (
    <text x={l.figureX} y={l.figureY + 10} textAnchor="middle" fontSize={30} className="msc-ring-figure mono" data-kind={l.kind}>
      {SLICE_CODE[l.kind]} {formatUsd(l.value, true)}
    </text>
  );
}

/** One Prime on the flow chart: its bar in its identity color, the ribbons
 *  feeding it (one mark per line item, the same marks the orbital pie's
 *  slices are), its To-Sky ribbons (one mark — the orbit's arrow), a stub
 *  on the right for each item that stayed, the loss stub on the left where
 *  a ribbon isn't, and its name + gross above the bar. */
export function FlowAgentGroup({ agent, flow, label, bandColor, to, month }: OverviewPrime & { agent: FlowAgent; month: string }) {
  const p = agent.prime;
  const group = (
    <g className="msc-ring-prime" data-prime={p}>
      {/* Each inbound ribbon's mark also holds the stub of what stayed, on
          the far side of the bar, so the pair hover and light as one. */}
      {agent.inbound.map((l) => {
        const stub = agent.retained.find((s) => s.kind === l.kind);
        return (
          <g key={l.kind} className="msc-ring-mark" data-mark={markId(p, l.kind)}>
            <path d={l.path} className={`msc-ring-slice msc-ring-${l.kind}`} />
            {stub && (
              <rect x={stub.x} y={stub.y} width={stub.w} height={stub.h} rx={Math.min(5, stub.h / 2)} className={`msc-ring-slice msc-ring-${l.kind} msc-flow-stub`} />
            )}
          </g>
        );
      })}
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
      {agent.loss && (
        <g className="msc-ring-mark" data-mark={markId(p, "loss")}>
          <rect x={agent.loss.x} y={agent.loss.y} width={agent.loss.w} height={agent.loss.h} className="msc-ring-hole" fill="url(#msc-ring-neg-kept)" />
        </g>
      )}
      <rect x={agent.x} y={agent.y} width={NODE_W} height={agent.h} className="msc-flow-agent" style={{ fill: bandColor }} />
      {agent.inbound.map((l) => (
        <LinkFigure key={`in-${l.kind}`} l={l} />
      ))}
      {agent.outbound.map((l) => (
        <LinkFigure key={`out-${l.kind}`} l={l} />
      ))}
      <g className="msc-ring-mark" data-mark={markId(p, "gross")}>
        <text x={agent.labelX} y={agent.labelY} textAnchor="middle" fontSize={36} className="msc-ring-label msc-flow-halo">
          {label}
        </text>
        <text x={agent.labelX} y={agent.labelY + 30} textAnchor="middle" fontSize={24} className="msc-ring-sublabel mono msc-flow-halo">
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
