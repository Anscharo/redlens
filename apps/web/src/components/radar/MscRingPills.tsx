import { formatUsd } from "../../lib/settlements";
import type { RingPrime } from "../../lib/mscOverviewLayout";
import { textWidth } from "../../lib/textWidth";

/** Must match `.msc-ring-pill text` (12px .mono). */
const PILL_FONT = "12px 'Source Code Pro', 'Courier New', monospace";

/** Marks and their pills live in different SVG layers (pills paint last, over
 *  everything), so they're paired by id rather than by nesting — see the
 *  generated `:has()` rules in MscRing. */
export const markId = (prime: string, kind: string): string => `${prime}::${kind}`;

/** "71%" — whole percent; a share over 100% is real (a Prime that owed Sky
 *  more than it made that month) and is shown as such. */
export const formatShare = (share: number): string => `${Math.round(share * 100)}%`;

/** Pill text names what it is, not just the number — a bare "$2.6M" says
 *  nothing about which flow it belongs to. */
export function pillText(kind: string, signed: number, primeLabel: string, share?: number | null): string {
  const amount = formatUsd(signed, true);
  if (kind === "sky") {
    return share != null
      ? `${amount} to Sky — ${formatShare(share)} of ${primeLabel}'s production`
      : `${amount} to Sky`;
  }
  if (kind === "share") return `${amount} to Sky from ${primeLabel}`;
  if (kind === "production") return `${amount} production* by ${primeLabel}`;
  if (kind === "kept") {
    return signed < 0 ? `${amount} supply loss to ${primeLabel}` : `${amount} supply kept by ${primeLabel}`;
  }
  return `${amount} demand-side to ${primeLabel}`;
}

interface PillProps {
  mark: string;
  text: string;
  /** Where the pill sits. */
  x: number;
  y: number;
  /** Where its leader touches the mark it names. */
  toX: number;
  toY: number;
}

/** One hover pill: a leader from the mark it names out to the pill itself,
 *  which sits clear of the shape so it never covers it or the prime's name. */
export function AmountPill({ mark, text, x, y, toX, toY }: PillProps) {
  const w = textWidth(text, PILL_FONT, 7.3) + 20;
  const h = 22;
  return (
    <g className="msc-ring-pill" data-mark={mark} aria-hidden="true">
      <path d={`M${toX},${toY} L${x},${y}`} className="msc-ring-pill-leader" />
      <circle cx={toX} cy={toY} r={2.5} className="msc-ring-pill-anchor" />
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={h / 2} />
      <text x={x} y={y + 4} textAnchor="middle" fontSize={12} className="mono">
        {text}
      </text>
    </g>
  );
}

interface OverlayProps {
  rings: { ring: RingPrime; label: string }[];
  /** Sky wedge pills: one per contributing prime. */
  wedges: { prime: string; label: string; value: number; x: number; y: number; toX: number; toY: number }[];
}

/** Every pill on the chart, rendered LAST so it paints over every bar,
 *  arrow and label — a pill nested in its own prime's group was painted
 *  over by whichever prime came after it. */
export function PillOverlay({ rings, wedges }: OverlayProps) {
  return (
    <g className="msc-ring-pills">
      {wedges.map((w) => (
        <AmountPill
          key={markId(w.prime, "share")}
          mark={markId(w.prime, "share")}
          text={pillText("share", w.value, w.label)}
          x={w.x}
          y={w.y}
          toX={w.toX}
          toY={w.toY}
        />
      ))}
      {rings.map(({ ring, label }) => (
        <g key={ring.prime}>
          <AmountPill
            mark={markId(ring.prime, "production")}
            text={pillText("production", ring.production, label)}
            x={ring.productionPillX}
            y={ring.productionPillY}
            toX={ring.productionAnchorX}
            toY={ring.productionAnchorY}
          />
          {ring.segments.map((s) => (
            <AmountPill
              key={s.kind}
              mark={markId(ring.prime, s.kind)}
              text={pillText(s.kind, s.signed, label)}
              x={s.pillX}
              y={s.pillY}
              toX={s.amountX}
              toY={s.amountY}
            />
          ))}
          {ring.arrow && (
            <AmountPill
              mark={markId(ring.prime, ring.arrow.kind)}
              text={pillText(ring.arrow.kind, ring.arrow.signed, label, ring.arrow.share)}
              x={ring.arrow.pillX}
              y={ring.arrow.pillY}
              toX={ring.arrow.amountX}
              toY={ring.arrow.amountY}
            />
          )}
        </g>
      ))}
    </g>
  );
}
