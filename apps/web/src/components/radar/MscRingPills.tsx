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

const COMPONENT: Record<string, string> = { cof: "cost of funds", sde: "Sky Direct Exposure" };

/** Pill text names what it is, not just the number — a bare "$2.6M" says
 *  nothing about which flow it belongs to. */
export function pillText(kind: string, signed: number, primeLabel: string, share?: number | null): string {
  const amount = formatUsd(signed, true);
  if (kind === "sky") {
    return share != null
      ? `${amount} to Sky — ${formatShare(share)} of ${primeLabel}'s gross revenue*`
      : `${amount} to Sky`;
  }
  if (kind in COMPONENT) return `${amount} ${COMPONENT[kind]} to Sky`;
  if (kind === "share") return `${amount} to Sky from ${primeLabel}`;
  if (kind === "gross") return `${amount} gross revenue* of ${primeLabel}`;
  if (kind === "kept") {
    return signed < 0 ? `${amount} supply loss to ${primeLabel}` : `${amount} supply kept by ${primeLabel}`;
  }
  return `${amount} demand-side to ${primeLabel}`;
}

interface PillProps {
  mark: string;
  text: string;
  /** Optional second line (the arrow total + share under a band's own figure). */
  detail?: string;
  /** Where the pill sits. */
  x: number;
  y: number;
  /** Where its leader touches the mark it names. */
  toX: number;
  toY: number;
}

/** One hover pill: a leader from the mark it names out to the pill itself,
 *  which sits clear of the shape so it never covers it or the prime's name. */
export function AmountPill({ mark, text, detail, x, y, toX, toY }: PillProps) {
  const w = Math.max(textWidth(text, PILL_FONT, 7.3), detail ? textWidth(detail, PILL_FONT, 7.3) : 0) + 20;
  const h = detail ? 38 : 22;
  return (
    <g className="msc-ring-pill" data-mark={mark} aria-hidden="true">
      <path d={`M${toX},${toY} L${x},${y}`} className="msc-ring-pill-leader" />
      <circle cx={toX} cy={toY} r={2.5} className="msc-ring-pill-anchor" />
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={11} />
      <text x={x} y={detail ? y - 4 : y + 4} textAnchor="middle" fontSize={12} className="mono">
        {text}
      </text>
      {detail && (
        <text x={x} y={y + 12} textAnchor="middle" fontSize={12} className="mono msc-ring-pill-detail">
          {detail}
        </text>
      )}
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
            mark={markId(ring.prime, "gross")}
            text={pillText("gross", ring.gross, label)}
            x={ring.grossPillX}
            y={ring.grossPillY}
            toX={ring.grossAnchorX}
            toY={ring.grossAnchorY}
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
          {ring.arrow?.bands.map((b) => (
            <AmountPill
              key={b.kind}
              mark={markId(ring.prime, b.kind)}
              text={pillText(b.kind, b.signed, label)}
              detail={pillText("sky", ring.arrow!.signed, label, ring.arrow!.share)}
              x={b.pillX}
              y={b.pillY}
              toX={b.amountX}
              toY={b.amountY}
            />
          ))}
        </g>
      ))}
    </g>
  );
}
