import { useId, type ReactNode } from "react";
import { formatUsd } from "../../lib/settlements";
import type { StreamModel } from "@/lib/settlementStreams";
import { citationFor } from "@/lib/settlementCitations";
import { ROUTES, atlasHref } from "@/lib/routes";
import { textWidth } from "../../lib/textWidth";
import { CX, CY, INNER0, OUTER0, OUTER_END, type VenueLabel } from "../../lib/settlementArcLayout";
import { SvgRouteLink } from "./SvgRouteLink";

export const UNCITED = "A workbook figure: the Atlas defines no term for it";
const VENUE_FONT = "9px 'Inter', system-ui, sans-serif";
/** A venue group narrower than this carries no name; its tooltip still does. */
const LABEL_MIN_W = 10;

/** A figure's text, linked to the Atlas document that defines it — or
 *  muted and unlinked when the Atlas defines no term for it. */
export function Cited({ figure, x, y, children, className = "" }: { figure: string; x: number; y: number; children: ReactNode; className?: string }) {
  const c = citationFor(figure);
  const text = (
    <text x={x} y={y} textAnchor="middle" className={`${c ? "msc-arc-cited" : "msc-arc-uncited"} ${className}`}>
      <title>{c ? `${c.term} — open in the Atlas` : UNCITED}</title>
      {children}
    </text>
  );
  return c ? <SvgRouteLink to={atlasHref(c.uuid)} className="msc-arc-link">{text}</SvgRouteLink> : text;
}

/** The name, cut to fit an arc of length `room`. */
function fit(label: string, room: number): string {
  if (textWidth(label, VENUE_FONT, 5.2) <= room) return label;
  let s = label;
  while (s.length > 1 && textWidth(`${s}…`, VENUE_FONT, 5.2) > room) s = s.slice(0, -1);
  return `${s}…`;
}

/** Each venue's name written along its group, from the Venues foot up. */
export function VenueLabels({ labels }: { labels: VenueLabel[] }) {
  const id = useId();
  return (
    <g className="msc-arc-venue-labels" fontSize={9}>
      {labels.filter((v) => v.w >= LABEL_MIN_W).map((v, i) => (
        <g key={v.venue} className="msc-arc-venue-label" data-venue={v.venue}>
          <path id={`${id}-${i}`} d={v.d} fill="none" />
          <text dominantBaseline="central">
            <textPath href={`#${id}-${i}`} startOffset={6}>{fit(v.label, (v.r * Math.PI) / 2 - 18)}</textPath>
          </text>
        </g>
      ))}
    </g>
  );
}

/** Node names and lane totals: Venues and Sky under their feet, the Prime
 *  over the apex with what it keeps (a workbook figure, muted). */
export function ArcNodeLabels({ model, primeLabel, month }: { model: StreamModel; primeLabel: string; month?: string }) {
  const sky = <text x={CX + (INNER0 + OUTER_END) / 2} y={CY + 26} textAnchor="middle" className="msc-arc-node-name">SKY</text>;
  const keptLoss = model.kept < 0;
  return (
    <g className="mono" fontSize={10}>
      <text x={CX - (OUTER0 + OUTER_END) / 2} y={CY + 26} textAnchor="middle" className="msc-arc-node-name">VENUES</text>
      {month ? <SvgRouteLink to={`${ROUTES.RADAR}?msc=${month}`} className="msc-arc-link" label="Open this month in the ecosystem Monthly Settlement Cycle overview">{sky}</SvgRouteLink> : sky}
      <Cited figure="toSky" x={CX + (INNER0 + OUTER_END) / 2} y={CY + 40}>{`To Sky ↻ ${formatUsd(model.toSky, true)}`}</Cited>
      <Cited figure="fromSky" x={CX + (INNER0 + OUTER_END) / 2} y={CY + 54}>{`↺ From Sky ${formatUsd(model.demandTotal, true)}`}</Cited>
      <text x={CX} y={CY - OUTER_END - 26} textAnchor="middle" fontSize={12} className="msc-arc-node-name">{primeLabel}</text>
      <text x={CX} y={CY - OUTER_END - 12} textAnchor="middle" className={`msc-arc-uncited${keptLoss ? " msc-arc-loss" : ""}`}>
        <title>{`${keptLoss ? "Supply-side loss" : "Supply-side kept"}. ${UNCITED}.`}</title>
        {`${keptLoss ? "loss" : "keeps"} ${formatUsd(model.kept, true)}`}
      </text>
    </g>
  );
}
