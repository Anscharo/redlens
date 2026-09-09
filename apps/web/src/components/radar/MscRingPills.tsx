import { DEMAND_SERIES, formatUsd } from "../../lib/settlements";
import type { RingPrime } from "../../lib/mscOverviewLayout";
import { textWidth } from "../../lib/textWidth";

/** Must match the pill's <text> (16px .mono). */
const PILL_FONT = "16px 'Source Code Pro', 'Courier New', monospace";
const PILL_FONT_PX = 16;
const PILL_CHAR_FALLBACK = 9.7;

/** Marks and their pills live in different SVG layers (pills paint last, over
 *  everything), so they're paired by id rather than by nesting — see the
 *  generated `:has()` rules in MscRing. */
export const markId = (prime: string, kind: string): string => `${prime}::${kind}`;

/** "71%" — whole percent; a share over 100% is real (a Prime that owed Sky
 *  more than it made that month) and is shown as such. */
export const formatShare = (share: number): string => `${Math.round(share * 100)}%`;

export { SLICE_CODE } from "../../lib/mscOverviewLayout";

/** The series token each line item is drawn in — the ring's slice fills
 *  (index.css `.msc-ring-<kind>`), the key's swatches and the Prime page's
 *  demand-side bars all read the same one. */
export const SLICE_TOKEN: Record<string, string> = {
  cof: "--msc-sky",
  sde: "--msc-sde",
  kept: "--msc-kept",
  agentRate: "--msc-demand",
  distributionRewards: "--msc-dr",
  gar: "--msc-gar",
  chroniclePoints: "--msc-cp",
};

/** Human names for the pie's line items (the workbook Summary's rows). */
export const SLICE_LABEL: Record<string, string> = {
  cof: "cost of funds → Sky",
  sde: "Sky Direct Exposure → Sky",
  kept: "supply-side kept",
  ...Object.fromEntries(DEMAND_SERIES.map((s) => [s.key, `${s.label.toLowerCase()} (demand-side)`])),
};

/** Pill text names what it is, not just the number — a bare "$2.6M" says
 *  nothing about which flow it belongs to. */
export function pillText(kind: string, signed: number, primeLabel: string, share?: number | null): string {
  const amount = formatUsd(signed, true);
  if (kind === "sky") {
    return share != null
      ? `${amount} to Sky — ${formatShare(share)} of ${primeLabel}'s gross revenue*`
      : `${amount} to Sky`;
  }
  if (kind === "share") return `${amount} to Sky from ${primeLabel}`;
  if (kind === "gross") return `${amount} gross revenue* of ${primeLabel}`;
  if (kind === "loss") return `${amount} supply-side loss`;
  if (kind in SLICE_LABEL) return `${amount} ${SLICE_LABEL[kind]}`;
  return `${amount} ${kind}`;
}

interface PillProps {
  mark: string;
  text: string;
  /** Optional lines ABOVE the main text, muted (the arrow's components). */
  detail?: string[];
  /** Where the pill sits. */
  x: number;
  y: number;
  /** Where its leader touches the mark it names. */
  toX: number;
  toY: number;
  /** Size multiplier: the flow chart's canvas is wider than the orbit's
   *  and renders about half the size, so it draws its pills at 2. */
  scale?: number;
}

/** One hover pill: a leader from the mark it names out to the pill itself,
 *  which sits clear of the shape so it never covers it or the prime's name. */
const LINE_H = 21;

export function AmountPill({ mark, text, detail = [], x, y, toX, toY, scale = 1 }: PillProps) {
  const lines = [...detail, text];
  const font = scale === 1 ? PILL_FONT : PILL_FONT.replace(/^\d+px/, `${PILL_FONT_PX * scale}px`);
  const w = Math.max(...lines.map((l) => textWidth(l, font, PILL_CHAR_FALLBACK * scale))) + 26 * scale;
  const h = (30 + (lines.length - 1) * LINE_H) * scale;
  const top = y - h / 2;
  return (
    <g className="msc-ring-pill" data-mark={mark} aria-hidden="true">
      {/* Stroke widths inline: the CSS rules set them, and a presentation
          attribute would lose to those. */}
      <path d={`M${toX},${toY} L${x},${y}`} className="msc-ring-pill-leader" style={{ strokeWidth: scale }} />
      <circle cx={toX} cy={toY} r={3 * scale} className="msc-ring-pill-anchor" />
      <rect x={x - w / 2} y={top} width={w} height={h} rx={15 * scale} style={{ strokeWidth: scale }} />
      {lines.map((l, i) => (
        <text
          key={i}
          x={x}
          y={top + (20 + i * LINE_H) * scale}
          textAnchor="middle"
          fontSize={PILL_FONT_PX * scale}
          className={i < detail.length ? "mono msc-ring-pill-detail" : "mono"}
        >
          {l}
        </text>
      ))}
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
          {ring.slices.map((s) => (
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
          {ring.hole && (
            <AmountPill
              mark={markId(ring.prime, "loss")}
              text={pillText("loss", ring.hole.signed, label)}
              x={ring.hole.pillX}
              y={ring.hole.pillY}
              toX={ring.cx}
              toY={ring.cy}
            />
          )}
          {ring.arrow && (
            <AmountPill
              mark={markId(ring.prime, ring.arrow.kind)}
              text={pillText(ring.arrow.kind, ring.arrow.signed, label, ring.arrow.share)}
              detail={[
                `${formatUsd(ring.arrow.cof, true)} cost of funds`,
                `${formatUsd(ring.arrow.sde, true)} Sky Direct Exposure`,
              ]}
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
