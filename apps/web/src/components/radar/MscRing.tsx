import { formatMonth } from "../../lib/settlements";
import type { RingLayout } from "../../lib/mscOverviewLayout";
import { markId, PillOverlay } from "./MscRingPills";
import { RingPrimeGroup, type MscRingPrime } from "./MscRingPrime";

export type { MscRingPrime } from "./MscRingPrime";

interface Props {
  layout: RingLayout;
  primes: MscRingPrime[];
  month: string;
  /** Compact ecosystem To-Sky figure shown inside the donut. */
  centerFigure: string;
}

/** How far outside the donut a wedge's pill sits. */
const WEDGE_PILL_GAP = 44;

export function MscRing({ layout, primes, month, centerFigure }: Props) {
  const colorOf = (prime: string) => primes.find((p) => p.flow.prime === prime)?.bandColor;
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

  return (
    <>
      <PillHoverStyles primes={primes} />
      <svg
        className="msc-ring"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-label={`Monthly Settlement Cycle flows for ${formatMonth(month)}`}
      >
        {/* Diagonal stripes in each series' own color: a negative flow keeps
            its category color (colors mean category on this chart) and is
            marked by stripes instead of a "loss" hue. */}
        <defs>
          {(["sky", "kept", "demand"] as const).map((k) => (
            <pattern
              key={k}
              id={`msc-ring-neg-${k}`}
              patternUnits="userSpaceOnUse"
              width={8}
              height={8}
              patternTransform="rotate(45)"
            >
              <rect width={4.5} height={8} style={{ fill: `var(--msc-${k})` }} />
            </pattern>
          ))}
        </defs>
        {/* The Sky donut IS the sum of the To-Sky flows, one wedge per Prime
            in that Prime's own color — so "these flows add up to Sky" is
            visible rather than asserted. */}
        <circle cx={layout.cx} cy={layout.cy} r={layout.skyR} className="msc-ring-sky-disc" />
        {layout.skyWedges.map((w) => (
          <g key={w.prime} className="msc-ring-mark" data-mark={markId(w.prime, "share")}>
            <path
              d={w.path}
              fillRule="evenodd"
              className="msc-ring-sky-wedge"
              data-prime={w.prime}
              style={{ fill: colorOf(w.prime) }}
            />
          </g>
        ))}
        <text x={layout.cx} y={layout.cy - 8} textAnchor="middle" fontSize={28} className="msc-ring-center">
          To Sky
        </text>
        <text x={layout.cx} y={layout.cy + 26} textAnchor="middle" fontSize={24} className="msc-ring-center mono">
          {centerFigure}
        </text>
        {primes.map((p) => (
          <RingPrimeGroup key={p.flow.prime} {...p} month={month} />
        ))}
        <PillOverlay rings={primes.map((p) => ({ ring: p.ring, label: p.label }))} wedges={wedgePills} />
      </svg>
    </>
  );
}

/* Pills paint in a top layer, so they are no longer descendants of the mark
   they name and plain `.mark:hover .pill` can't reach them. One generated
   `:has()` rule per mark pairs them back up by id — the same trick the venue
   sankey's VenueHoverStyles uses. Keyboard focus on a prime's link reveals
   that prime's pills (prefix match) since there is no per-mark focus target. */
function PillHoverStyles({ primes }: { primes: MscRingPrime[] }) {
  const css = primes
    .flatMap((p) => {
      const kinds = [...p.ring.slices.map((s) => s.kind as string), "share", "gross"];
      if (p.ring.hole) kinds.push("loss");
      if (p.ring.arrow) kinds.push(p.ring.arrow.kind);
      const rules = kinds.map((k) => {
        const id = markId(p.flow.prime, k);
        return `.msc-ring:has(.msc-ring-mark[data-mark="${id}"]:hover) .msc-ring-pill[data-mark="${id}"] { opacity: 1; }`;
      });
      rules.push(
        `.msc-ring:has(a:focus-visible .msc-ring-prime[data-prime="${p.flow.prime}"]) .msc-ring-pill[data-mark^="${p.flow.prime}::"] { opacity: 1; }`,
      );
      return rules;
    })
    .join("\n");
  return <style>{css}</style>;
}
