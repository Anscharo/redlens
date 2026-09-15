import {
  formatMonth,
  formatUsd,
  threeWayPeaks,
  barFillStyle,
  type ThreeWayMonth,
} from "../../lib/settlements";
import { MscMonthLabel } from "./MscMonthLabel";

/** Paging through more cycles than the chart shows at once. */
export interface CyclePaging {
  earlier: boolean;
  later: boolean;
  onEarlier: () => void;
  onLater: () => void;
}

export function SettlementBars({
  months,
  selected,
  onSelect,
}: {
  months: ThreeWayMonth[];
  selected: string;
  onSelect: (month: string) => void;
}) {
  const { peakPos, peakNeg } = threeWayPeaks(months);
  const keys = months.map((m) => m.month);
  return (
    <div className="mb-4">
      <div className="flex items-end gap-3 mb-2" role="group" aria-label="Settlement months">
        {months.map((m, i) => (
          <button
            key={m.month}
            type="button"
            className="msc-bar-col"
            data-active={m.month === selected ? "true" : undefined}
            onClick={() => onSelect(m.month)}
            aria-pressed={m.month === selected}
            aria-label={`${formatMonth(m.month)}: ${formatUsd(m.sky, true)} to Sky, ${formatUsd(m.kept, true)} supply-side kept, ${formatUsd(m.demand, true)} demand-side`}
          >
            <span className="msc-bar-cluster" aria-hidden="true">
              <ThreeWayTrack value={m.sky} peakPos={peakPos} peakNeg={peakNeg} barClass="msc-bar-sky" />
              <ThreeWayTrack value={m.kept} peakPos={peakPos} peakNeg={peakNeg} barClass="msc-bar-prime" />
              <ThreeWayTrack value={m.demand} peakPos={peakPos} peakNeg={peakNeg} barClass="msc-bar-demand" />
            </span>
            <MscMonthLabel months={keys} index={i} />
          </button>
        ))}
      </div>
    </div>
  );
}

function ThreeWayTrack({
  value,
  peakPos,
  peakNeg,
  barClass,
}: {
  value: number;
  peakPos: number;
  peakNeg: number;
  barClass: string;
}) {
  const fill = barFillStyle(value, peakPos, peakNeg);
  const span = peakPos + peakNeg;
  const zero = span > 0 ? (peakNeg / span) * 100 : 0;
  return (
    <span className="msc-bar-track">
      {peakNeg > 0 && <span className="msc-bar-zero" style={{ bottom: `${zero}%` }} />}
      {/* A negative month keeps its series color and is striped (CSS). */}
      {fill && (
        <span
          className={`msc-bar-fill ${barClass}`}
          data-negative={value < 0 ? "true" : undefined}
          style={fill}
        />
      )}
    </span>
  );
}
