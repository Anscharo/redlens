import { type ReactNode } from "react";
import { formatUsd } from "../../lib/settlements";
import type { StreamModel } from "@/lib/settlementStreams";
import { citationFor } from "@/lib/settlementCitations";
import { ROUTES, atlasHref } from "@/lib/routes";
import { textWidth } from "../../lib/textWidth";
import { CX, CY, OUTER_END, type VenueBand } from "../../lib/settlementArcLayout";
import { SvgRouteLink } from "./SvgRouteLink";

export const UNCITED = "A workbook figure: the Atlas defines no term for it";
const VENUE_FONT = "11px 'Inter', system-ui, sans-serif";

/** A figure's text, linked to the Atlas document that defines it — or
 *  muted and unlinked when the Atlas defines no term for it. */
export function Cited({ figure, x, y, children, className = "" }: { figure: string; x: number; y: number; children: ReactNode; className?: string }) {
  const c = citationFor(figure);
  const text = (
    <text x={x} y={y} className={`${c ? "msc-arc-cited" : "msc-arc-uncited"} ${className}`}>
      <title>{c ? `${c.term} — open in the Atlas` : UNCITED}</title>
      {children}
    </text>
  );
  return c ? <SvgRouteLink to={atlasHref(c.uuid)} className="msc-arc-link">{text}</SvgRouteLink> : text;
}

/** The name, cut to fit an arc of length `room`. */
function fit(label: string, room: number): string {
  if (textWidth(label, VENUE_FONT, 6.2) <= room) return label;
  let s = label;
  while (s.length > 1 && textWidth(`${s}…`, VENUE_FONT, 6.2) > room) s = s.slice(0, -1);
  return `${s}…`;
}

/** Each band's venue name beside where it starts, right-aligned to it, so
 *  the staggered starts read as a list of sources. An SDE band says so. */
export function VenueLabels({ venues }: { venues: VenueBand[] }) {
  return (
    <g className="msc-arc-venue-labels" fontSize={11}>
      {venues.map((v) => (
        <text key={v.key} x={v.labelAt.x} y={v.labelAt.y} textAnchor="end" dominantBaseline="central" className="msc-arc-venue-label" data-venue={v.venue}>
          <title>{v.key.endsWith("::sde") ? `${v.label}: Sky Direct Exposure` : v.label}</title>
          {v.key.endsWith("::sde") ? `${fit(v.label, v.labelAt.x - 40)} · SDE` : fit(v.label, v.labelAt.x - 4)}
        </text>
      ))}
    </g>
  );
}

/** Node names and lane totals: Sky right of its node, the Prime over the
 *  apex with what it keeps (a workbook figure, muted). */
export function ArcNodeLabels({ model, primeLabel, month }: { model: StreamModel; primeLabel: string; month?: string }) {
  const x = CX + OUTER_END + 10;
  const sky = <text x={x} y={CY + 4} className="msc-arc-node-name">SKY</text>;
  const keptLoss = model.kept < 0;
  return (
    <g className="mono" fontSize={10}>
      {month ? <SvgRouteLink to={`${ROUTES.RADAR}?msc=${month}`} className="msc-arc-link" label="Open this month in the ecosystem Monthly Settlement Cycle overview">{sky}</SvgRouteLink> : sky}
      <Cited figure="toSky" x={x} y={CY - 14}>{`to Sky ${formatUsd(model.toSky, true)}`}</Cited>
      <Cited figure="fromSky" x={x} y={CY + 22}>{`from Sky ${formatUsd(model.demandTotal, true)}`}</Cited>
      <text x={CX} y={CY - OUTER_END - 28} textAnchor="middle" fontSize={12} className="msc-arc-node-name">{primeLabel}</text>
      <text x={CX} y={CY - OUTER_END - 13} textAnchor="middle" className={`msc-arc-uncited${keptLoss ? " msc-arc-loss" : ""}`}>
        <title>{`${keptLoss ? "Supply-side loss" : "Supply-side kept"}. ${UNCITED}.`}</title>
        {`${keptLoss ? "loss" : "keeps"} ${formatUsd(model.kept, true)}`}
      </text>
    </g>
  );
}
