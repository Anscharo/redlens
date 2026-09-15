import { formatMonth, formatUsd } from "../../lib/settlements";
import type { RingLayout } from "../../lib/mscOverviewLayout";
import { markId, PillOverlay } from "./MscRingPills";
import { RingPrimeGroup, type MscRingPrime } from "./MscRingPrime";
import { RingHoverStyles } from "./MscRingHoverStyles";

export type { MscRingPrime } from "./MscRingPrime";

interface Props {
  layout: RingLayout;
  primes: MscRingPrime[];
  month: string;
  /** Compact ecosystem To-Sky figure, shown above the Sky pie. */
  centerFigure: string;
}

/** How far outside the donut a wedge's pill sits. */
const WEDGE_PILL_GAP = 44;

export function MscRing({ layout, primes, month, centerFigure }: Props) {
  const labelOf = (prime: string) => primes.find((p) => p.flow.prime === prime)?.label ?? prime;
  // Wedge pills ride just outside the donut on the wedge's own radial, where
  // its arrow docks.
  const midR = (layout.skyR + layout.skyInnerR) / 2;
  const wedgePills = layout.skyWedges.map((w) => ({
    prime: w.prime,
    label: labelOf(w.prime),
    value: w.value,
    toX: layout.cx + midR * Math.cos(w.mid),
    toY: layout.cy + midR * Math.sin(w.mid),
    x: layout.cx + (layout.skyR + WEDGE_PILL_GAP) * Math.cos(w.mid),
    y: layout.cy + (layout.skyR + WEDGE_PILL_GAP) * Math.sin(w.mid),
  }));

  const marks = primes.map((p) => {
    const kinds = [...p.ring.slices.map((s) => s.kind as string), "share", "received"];
    if (p.ring.hole) kinds.push("loss");
    if (p.ring.arrow) kinds.push(p.ring.arrow.kind);
    if (p.ring.demandArrow) kinds.push("demand");
    return { prime: p.flow.prime, kinds };
  });

  return (
    <>
      <RingHoverStyles marks={marks} />
      <figure
        className="msc-ring-frame"
        aria-label={`Monthly Settlement Cycle flows for ${formatMonth(month)}`}
      >
        <svg
          className="msc-ring"
          viewBox={`${layout.x} ${layout.y} ${layout.width} ${layout.height}`}
          preserveAspectRatio="xMidYMid meet"
        >
        {/* The loss mark: diagonal stripes in the loss red (a negative
            arrow, the hole) — the same mark every MSC chart uses. */}
        <defs>
          <pattern id="msc-ring-loss" patternUnits="userSpaceOnUse" width={8} height={8} patternTransform="rotate(45)">
            <rect width={4.5} height={8} style={{ fill: "var(--msc-loss)" }} />
          </pattern>
        </defs>
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
            <text key={w.prime} x={w.figureX} y={w.figureY} textAnchor="middle" fontSize={15} className="msc-ring-figure" data-kind="sky" data-prime={w.prime}>
              <tspan x={w.figureX} dy={-4}>
                {labelOf(w.prime)}
              </tspan>
              <tspan x={w.figureX} dy={18} className="mono">
                {formatUsd(w.value, true)}
              </tspan>
            </text>
          ) : null,
        )}
        {/* Sky's name and total above its pie — the same name-then-figure
            treatment, sizes and inks as a Prime's. */}
        <text x={layout.cx} y={layout.cy - layout.skyR - 38} textAnchor="middle" fontSize={24} className="msc-ring-label">
          To Sky
        </text>
        <text x={layout.cx} y={layout.cy - layout.skyR - 18} textAnchor="middle" fontSize={16} className="msc-ring-sublabel mono">
          {centerFigure}
        </text>
        {primes.map((p) => (
          <RingPrimeGroup key={p.flow.prime} {...p} month={month} />
        ))}
        <PillOverlay rings={primes.map((p) => ({ ring: p.ring, label: p.label }))} wedges={wedgePills} />
        </svg>
      </figure>
    </>
  );
}
