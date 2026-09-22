import { formatUsd } from "../../lib/settlements";
import {
  FIGURE_SIZE, NAME_SIZE, SKY_LABEL_DY, SKY_SUBLABEL_DY, SUBLABEL_SIZE, WEDGE_TSPAN_DY,
  type RingLayout,
} from "../../lib/mscOverviewLayout";
import { markId } from "./MscRingPills";
import { RingPrimeGroup, type MscRingPrime } from "./MscRingPrime";

interface ChartProps {
  layout: RingLayout;
  primes: MscRingPrime[];
  month: string;
  centerFigure: string;
  labelOf: (prime: string) => string;
}

/** Everything under the clip: Sky, its wedges and labels, and every Prime. */
export function RingChart({
  layout, primes, month, centerFigure, labelOf,
}: ChartProps) {
  return (
    <>
      {/* Sky's pie is what SKY received — cost of funds and Sky Direct
          Exposure — one wedge per Prime, so "these flows add up to Sky"
          is visible rather than asserted, and each wedge split by which
          of the two it is. The two fills are the same tokens the source
          labels and the key use, so a wedge names itself. */}
      <circle cx={layout.cx} cy={layout.cy} r={layout.skyR} className="msc-ring-sky-disc" />
      {layout.skyWedges.map((w) => (
        <g key={w.prime} className="msc-ring-mark" data-mark={markId(w.prime, "share")} style={w.alpha < 1 ? { opacity: w.alpha } : undefined}>
          {w.parts.map((part) => (
            <path
              key={part.kind}
              d={part.path}
              fillRule="evenodd"
              className={`msc-ring-sky-wedge msc-ring-${part.kind}`}
              data-prime={w.prime}
              data-kind={part.kind}
            />
          ))}
        </g>
      ))}
      {layout.skyWedges.map((w) =>
        w.figureX != null && w.figureY != null ? (
          <text key={w.prime} x={w.figureX} y={w.figureY} textAnchor="middle" fontSize={FIGURE_SIZE} className="msc-ring-figure" data-kind="sky" data-prime={w.prime}>
            <tspan x={w.figureX} dy={WEDGE_TSPAN_DY[0]}>
              {labelOf(w.prime)}
            </tspan>
            <tspan x={w.figureX} dy={WEDGE_TSPAN_DY[1]} className="mono">
              {formatUsd(w.value, true)}
            </tspan>
          </text>
        ) : null,
      )}
      {/* Sky's name and total above its pie — the same name-then-figure
          treatment, sizes and inks as a Prime's. */}
      <text x={layout.cx} y={layout.cy - layout.skyR - SKY_LABEL_DY} textAnchor="middle" fontSize={NAME_SIZE} className="msc-ring-label">
        To Sky
      </text>
      <text x={layout.cx} y={layout.cy - layout.skyR - SKY_SUBLABEL_DY} textAnchor="middle" fontSize={SUBLABEL_SIZE} className="msc-ring-sublabel mono">
        {centerFigure}
      </text>
      {primes.map((p) => (
        <RingPrimeGroup key={p.flow.prime} {...p} month={month} />
      ))}
    </>
  );
}
