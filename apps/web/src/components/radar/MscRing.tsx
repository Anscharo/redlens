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
  // Sky's wedges are shades of Sky's own blue — the BIGGEST contributor in
  // the blue itself, then the --msc-sky-2/3/4 shades down the ranking — so
  // the pie reads as one pool of money and the shading carries size. The
  // shades are theme tokens audited against --msc-sky-ink, which is what
  // the figures on them (and the "To Sky" total across them) are set in.
  const rank = new Map(
    [...layout.skyWedges].sort((a, b) => b.value - a.value).map((w, i) => [w.prime, i] as const),
  );
  const shade = (prime: string) => {
    const r = rank.get(prime) ?? 0;
    return r === 0 ? "var(--msc-sky)" : `var(--msc-sky-${Math.min(r + 1, 4)})`;
  };
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
    const kinds = [...p.ring.slices.map((s) => s.kind as string), "share", "gross"];
    if (p.ring.hole) kinds.push("loss");
    if (p.ring.arrow) kinds.push(p.ring.arrow.kind);
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
        {/* The Sky pie IS the sum of the To-Sky flows, one wedge per Prime —
            so "these flows add up to Sky" is visible rather than asserted. */}
        <circle cx={layout.cx} cy={layout.cy} r={layout.skyR} className="msc-ring-sky-disc" />
        {layout.skyWedges.map((w) => (
          <g key={w.prime} className="msc-ring-mark" data-mark={markId(w.prime, "share")}>
            <path
              d={w.path}
              fillRule="evenodd"
              className="msc-ring-sky-wedge"
              data-prime={w.prime}
              style={{ fill: shade(w.prime) }}
            />
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
