import { type ReactNode } from "react";
import { formatUsd } from "../../lib/settlements";
import type { StreamModel } from "@/lib/settlementStreams";
import { citationFor } from "@/lib/settlementCitations";
import { ROUTES, atlasHref } from "@/lib/routes";
import { textWidth } from "../../lib/textWidth";
import { CX, CY, INNER_OUT, OUTER_END, type DemandLabel, type Span, type VenueBand } from "../../lib/settlementArcLayout";
import { SvgRouteLink } from "./SvgRouteLink";
import { arcInk } from "./arcInk";

export const UNCITED = "A workbook figure: the Atlas defines no term for it";
const VENUE_FONT = "11px 'Inter', system-ui, sans-serif";

/** A figure's text, linked to the Atlas document that defines it — or
 *  muted and unlinked when the Atlas defines no term for it. */
export function Cited({ figure, x, y, children, className = "", anchor }: { figure: string; x: number; y: number; children: ReactNode; className?: string; anchor?: "end" }) {
  const c = citationFor(figure);
  const text = (
    <text x={x} y={y} textAnchor={anchor} className={`${c ? "msc-arc-cited" : "msc-arc-uncited"} ${className}`}>
      <title>{c ? `${c.term} — open in the Atlas` : UNCITED}</title>
      {children}
    </text>
  );
  return c ? <SvgRouteLink to={atlasHref(c.uuid)} className="msc-arc-link">{text}</SvgRouteLink> : text;
}

const venueText = (v: VenueBand) => (v.key.endsWith("::sde") ? `${v.label} · SDE` : v.label);

/** The leftmost x any venue name reaches, so the figure can widen to show
 *  every name whole. Never right of 0. */
export function labelsLeft(venues: VenueBand[]): number {
  return Math.min(0, ...venues.map((v) => v.labelAt.x - textWidth(venueText(v), VENUE_FONT, 6.2) - 4));
}

/** Each band's venue name, whole, beside where it starts and right-aligned
 *  to it, so the staggered starts read as a list of sources. An SDE band
 *  says so. */
export function VenueLabels({ venues }: { venues: VenueBand[] }) {
  return (
    <g className="msc-arc-venue-labels" fontSize={11}>
      {venues.map((v) => (
        <text key={v.key} x={v.labelAt.x} y={v.labelAt.y} textAnchor="end" dominantBaseline="central" className="msc-arc-venue-label" data-venue={v.venue}>
          <title>{v.key.endsWith("::sde") ? `${v.label}: Sky Direct Exposure` : v.label}</title>
          {venueText(v)}
        </text>
      ))}
    </g>
  );
}

/** Each demand series named beside its band at the bottom-left of the
 *  circle, a leader in the series' colour running out to it. Cited series
 *  link to their Atlas definition. */
export function DemandLabels({ labels, name }: { labels: DemandLabel[]; name: (key: string) => string }) {
  return (
    <g className="mono" fontSize={10}>
      {labels.map((l) => (
        <g key={l.key}>
          <path d={l.leader} className="msc-arc-leader" stroke={arcInk(l.key)} />
          <Cited figure={l.key} x={l.x} y={l.y} anchor="end" className="msc-arc-demand-label">{`${name(l.key)} ${formatUsd(l.value, true)}`}</Cited>
        </g>
      ))}
    </g>
  );
}

/** "to Sky" sits beside the arrow arriving at Sky, this far above Sky's
 *  node; "from Sky" inside the circle by the demand lane leaving it, this
 *  far below. */
const TO_SKY_RISE = 48;
const FROM_SKY_DROP = 28;

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
      <Cited figure="fromSky" x={atRise(r0, FROM_SKY_DROP) - 8} y={CY + FROM_SKY_DROP} anchor="end">{`from Sky ${formatUsd(model.demandTotal, true)}`}</Cited>
      <text x={CX} y={CY - outerEdge - 32} textAnchor="middle" fontSize={12} className="msc-arc-node-name">{primeLabel}</text>
      <text x={CX} y={CY - outerEdge - 14} textAnchor="middle" className={`msc-arc-uncited${keptLoss ? " msc-arc-loss" : ""}`}>
        <title>{`${keptLoss ? "Supply-side loss" : "Supply-side kept"}. ${UNCITED}.`}</title>
        {`${keptLoss ? "loss" : "keeps"} ${formatUsd(model.kept, true)}`}
      </text>
    </g>
  );
}
