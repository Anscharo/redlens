import { formatUsd, SETTLEMENT_NEAR_ZERO } from "../../lib/settlements";
import type { StreamModel } from "@/lib/settlementStreams";
import { ROUTES } from "@/lib/routes";
import { CX, CY, INNER_OUT, OUTER_END, type Span } from "../../lib/settlementArcLayout";
import { SvgRouteLink } from "./SvgRouteLink";
import { Cited, UNCITED } from "./SettlementArcLabels";

/** "to Sky" sits beside the arrow arriving at Sky, this far above Sky's
 *  node; "from Sky" inside the circle by the demand lane leaving it, this
 *  far below. */
const TO_SKY_RISE = 48;
const FROM_SKY_DROP = 28;

const OTHER_FROM_SKY = "Core Governance Reward and Chronicle compensation: paid by Sky alongside the settlement, each under its own Atlas document";

/** What Sky pays: the Stage 1 amount due (agent rate and distribution
 *  rewards), linked to its definition, and under it whatever else Sky pays
 *  alongside — each series of which is named and cited on the lane. */
function FromSky({ model, x, y }: { model: StreamModel; x: number; y: number }) {
  const other = model.demandTotal - model.demandMsc;
  const hasOther = Math.abs(other) >= SETTLEMENT_NEAR_ZERO;
  if (Math.abs(model.demandMsc) < SETTLEMENT_NEAR_ZERO) {
    return hasOther ? <text x={x} y={y} textAnchor="end" className="msc-arc-uncited"><title>{OTHER_FROM_SKY}</title>{`from Sky ${formatUsd(other, true)}`}</text> : null;
  }
  return (
    <g>
      <Cited figure="fromSky" x={x} y={y} anchor="end">{`from Sky ${formatUsd(model.demandMsc, true)}`}</Cited>
      {hasOther && <text x={x} y={y + 13} textAnchor="end" className="msc-arc-uncited"><title>{OTHER_FROM_SKY}</title>{`+ ${formatUsd(other, true)} other rewards`}</text>}
    </g>
  );
}

/** Node names and lane totals: "to Sky" beside the arrow arriving at Sky,
 *  "from Sky" inside the circle beside the demand lane leaving it, SKY
 *  right of its node in the Prime name's size; the Prime just over its
 *  node with what it keeps (a workbook figure, muted). */
export function ArcNodeLabels({ model, primeLabel, month, sky: span, outerEdge }: { model: StreamModel; primeLabel: string; month?: string; sky: Span | null; outerEdge: number }) {
  const r1 = span?.r1 ?? OUTER_END;
  const r0 = span?.r0 ?? INNER_OUT;
  // x of a circle of radius r at height dy from the centre line.
  const atRise = (r: number, dy: number) => CX + Math.sqrt(Math.max(r * r - dy * dy, 0));
  const sky = <text x={CX + r1 + 8} y={CY + 4} fontSize={12} className="msc-arc-node-name">SKY</text>;
  const keptLoss = model.kept < 0;
  return (
    <g className="mono" fontSize={10}>
      {month ? <SvgRouteLink to={`${ROUTES.RADAR}?msc=${month}`} className="msc-arc-link" label="Open this month in the ecosystem Monthly Settlement Cycle overview">{sky}</SvgRouteLink> : sky}
      <Cited figure="toSky" x={atRise(r1, TO_SKY_RISE) + 10} y={CY - TO_SKY_RISE}>{`to Sky ${formatUsd(model.toSky, true)}`}</Cited>
      <FromSky model={model} x={atRise(r0, FROM_SKY_DROP) - 8} y={CY + FROM_SKY_DROP} />
      <text x={CX} y={CY - outerEdge - 32} textAnchor="middle" fontSize={12} className="msc-arc-node-name">{primeLabel}</text>
      <text x={CX} y={CY - outerEdge - 14} textAnchor="middle" className={`msc-arc-uncited${keptLoss ? " msc-arc-loss" : ""}`}>
        <title>{`${keptLoss ? "Supply-side loss" : "Supply-side kept"}. ${UNCITED}.`}</title>
        {`${keptLoss ? "loss" : "keeps"} ${formatUsd(model.kept, true)}`}
      </text>
    </g>
  );
}
