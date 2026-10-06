import { useMemo, type ReactNode } from "react";
import type { StreamModel } from "@/lib/settlementStreams";
import { SETTLEMENT_CITATIONS, citationFor } from "@/lib/settlementCitations";
import { atlasHref } from "@/lib/routes";
import { layoutSettlementArc } from "../../lib/settlementArcLayout";
import { AtlasLink } from "../AtlasLink";
import { SettlementArcSvg, arcInk, venueInk } from "./SettlementArcSvg";
import { UNCITED } from "./SettlementArcLabels";
import { SettlementVenueTable } from "./SettlementVenueTable";

/**
 * Static CSS can't match "same data-venue as the hovered element" — emit one
 * rule per id. Hovering a venue's stripes, name or table row raises all three.
 */
function VenueHoverStyles({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  const rules = ids.map((id) => {
    const s = CSS.escape(id);
    return `
.msc-arc-frame:has([data-venue="${s}"]:hover) .msc-arc-band[data-venue="${s}"] { opacity: 1; }
.msc-arc-frame:has([data-venue="${s}"]:hover) tr[data-venue="${s}"] { background: var(--row-hover); }`;
  }).join("");
  return <style>{rules}</style>;
}

/** A key entry: the swatch, then the term linked to its Atlas definition,
 *  or muted when the Atlas defines none. */
function KeyItem({ figure, background, children }: { figure: string; background: string; children: ReactNode }) {
  const c = citationFor(figure);
  return (
    <span>
      <span className="inline-block w-2 h-2 mr-1 align-middle" style={{ background }} aria-hidden="true" />
      {c ? <AtlasLink to={atlasHref(c.uuid)} className="msc-arc-caption-link" title={c.term}>{children}</AtlasLink> : <span className="msc-arc-muted" title={UNCITED}>{children}</span>}
    </span>
  );
}

/** The key's venue swatch: the first few venues' colours side by side. */
function venueSwatch(keys: string[]): string {
  const inks = keys.slice(0, 3).map(venueInk);
  if (inks.length === 0) return "var(--msc-sky)";
  return `linear-gradient(90deg, ${[...inks, inks[inks.length - 1]].join(", ")})`;
}

function KeyLink({ figure, children }: { figure: string; children: ReactNode }) {
  const c = citationFor(figure)!;
  return <AtlasLink to={atlasHref(c.uuid)} className="msc-arc-caption-link" title={c.term}>{children}</AtlasLink>;
}

/** A Prime's month as a rainbow: clockwise, what the Prime keeps stops at
 *  it while each venue's cost of funds and Sky Direct Exposure run through
 *  it to Sky; counterclockwise, Sky pays the demand side back. The venue
 *  table under it splits every venue row by row. */
export function SettlementArc({ model, primeLabel, month }: { model: StreamModel; primeLabel: string; month?: string }) {
  const layout = useMemo(() => layoutSettlementArc(model), [model]);
  const ids = useMemo(() => model.venues.map((v) => v.id), [model.venues]);
  const { toSky, fromSky, execVote } = SETTLEMENT_CITATIONS;
  return (
    <figure className="msc-arc-frame m-0" aria-label={`Settlement flows between ${primeLabel} and Sky`}>
      <VenueHoverStyles ids={ids} />
      <div className="mono text-[10px] flex flex-wrap gap-x-4 gap-y-1 mb-2" style={{ color: "var(--tan-3)" }}>
        <KeyItem figure="kept" background={arcInk("kept")}>kept by {primeLabel}</KeyItem>
        <span>
          <span className="inline-block w-2 h-2 mr-1 align-middle" style={{ background: venueSwatch(layout.venues.map((v) => v.key)) }} aria-hidden="true" />
          each venue&rsquo;s <KeyLink figure="cof">CoF</KeyLink> + <KeyLink figure="sde">SDE</KeyLink> → Sky
        </span>
        {model.demand.map((d) => <KeyItem key={d.key} figure={d.key} background={arcInk(d.key)}>{d.label}</KeyItem>)}
      </div>
      <SettlementArcSvg layout={layout} model={model} primeLabel={primeLabel} month={month} />
      <figcaption className="mono text-[10px] mt-1" style={{ color: "var(--tan-3)" }}>
        Clockwise, outer: venue revenue runs through {primeLabel}; what it keeps stops there, and the rest is the <AtlasLink to={atlasHref(toSky.uuid)} className="msc-arc-caption-link">amount due from {primeLabel} to Sky</AtlasLink>.
        Counterclockwise, inner: the <AtlasLink to={atlasHref(fromSky.uuid)} className="msc-arc-caption-link">amount due from Sky to {primeLabel}</AtlasLink>.
        Both are paid in the <AtlasLink to={atlasHref(execVote.uuid)} className="msc-arc-caption-link">Sky Core Executive Vote</AtlasLink> as two amounts, never netted.
        Muted figures are Soter Labs workbook figures the Atlas defines no term for; striped is a loss.
      </figcaption>
      <SettlementVenueTable model={model} primeLabel={primeLabel} />
    </figure>
  );
}
