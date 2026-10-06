import { useMemo, type ReactNode } from "react";
import type { StreamModel } from "@/lib/settlementStreams";
import { SETTLEMENT_CITATIONS, citationFor } from "@/lib/settlementCitations";
import { atlasHref } from "@/lib/routes";
import { layoutSettlementArc, type ArcFrame } from "../../lib/settlementArcLayout";
import { AtlasLink } from "../AtlasLink";
import { formatUsd } from "../../lib/settlements";
import type { AtlasAmountDue } from "@/lib/settlementAtlasCheck";
import { SettlementArcSvg } from "./SettlementArcSvg";
import { arcInk } from "./arcInk";
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
function venueSwatch(keys: string[], all: Map<string, string>): string {
  const inks = keys.slice(0, 3).map((k) => all.get(k)!);
  if (inks.length === 0) return "var(--msc-sky)";
  return `linear-gradient(90deg, ${[...inks, inks[inks.length - 1]].join(", ")})`;
}

function KeyLink({ figure, children }: { figure: string; children: ReactNode }) {
  const c = citationFor(figure)!;
  return <AtlasLink to={atlasHref(c.uuid)} className="msc-arc-caption-link" title={c.term}>{children}</AtlasLink>;
}

/** A Prime's month as one clockwise circle: each venue's revenue reaches
 *  the Prime, which passes that venue's cost of funds on to Sky and keeps
 *  the rest, while Sky Direct Exposure runs past it to Sky; from Sky,
 *  round the bottom, the demand side comes back to the Prime. The venue
 *  table under it splits every venue row by row. */
/** The month's amount due to Sky under the Atlas's per-venue floor, next
 *  to Soter's — one muted line, only when they differ by a dollar or more. */
function AtlasGap({ due, primeLabel }: { due?: AtlasAmountDue; primeLabel: string }) {
  if (!due || Math.abs(due.gap) < 1) return null;
  return (
    <span className="block mt-1">
      Under the Atlas&rsquo;s Stage 1 formula no venue costs {primeLabel} more than it earns (<AtlasLink to={atlasHref(SETTLEMENT_CITATIONS.instanceProfit.uuid)} className="msc-arc-caption-link">Instance Profit</AtlasLink>), so {formatUsd(due.atlas)} would be due to Sky, {formatUsd(due.gap)} less than Soter&rsquo;s figure, which charges each venue its full cost of funds.
    </span>
  );
}

export function SettlementArc({ model, primeLabel, month, inks, due, frame }: { model: StreamModel; primeLabel: string; month?: string; inks: Map<string, string>; due?: AtlasAmountDue; frame?: ArcFrame }) {
  const layout = useMemo(() => layoutSettlementArc(model), [model]);
  const ids = useMemo(() => model.venues.map((v) => v.id), [model.venues]);
  const { toSky, fromSky, execVote, cof, sde } = SETTLEMENT_CITATIONS;
  return (
    <figure className="msc-arc-frame m-0" aria-label={`Settlement flows between ${primeLabel} and Sky`}>
      <VenueHoverStyles ids={ids} />
      <div className="mono text-[10px] flex flex-wrap gap-x-4 gap-y-1 mb-2" style={{ color: "var(--tan-3)" }}>
        <span>
          <span className="inline-block w-2 h-2 mr-1 align-middle" style={{ background: venueSwatch(layout.revenue.map((v) => v.venue), inks) }} aria-hidden="true" />
          each venue&rsquo;s revenue → {primeLabel}, its <KeyLink figure="cof">cost of funds</KeyLink> → Sky
        </span>
        <KeyItem figure="kept" background={arcInk("kept")}>kept by {primeLabel}</KeyItem>
        {layout.sde.length > 0 && (
          <span>
            <span className="inline-block w-2 h-2 mr-1 align-middle opacity-60" style={{ background: venueSwatch(layout.sde.map((v) => v.venue), inks) }} aria-hidden="true" />
            <KeyLink figure="sde">SDE</KeyLink> → Sky, past {primeLabel}
          </span>
        )}
        {model.demand.map((d) => <KeyItem key={d.key} figure={d.key} background={arcInk(d.key)}>{d.label}</KeyItem>)}
      </div>
      <SettlementArcSvg layout={layout} model={model} primeLabel={primeLabel} month={month} inks={inks} frame={frame} />
      <figcaption className="mono text-[10px] mt-1" style={{ color: "var(--tan-3)" }}>
        Clockwise: each venue&rsquo;s revenue reaches {primeLabel}, which passes that venue&rsquo;s <AtlasLink to={atlasHref(cof.uuid)} className="msc-arc-caption-link">cost of funds</AtlasLink> on to Sky and keeps the rest (green in its node); <AtlasLink to={atlasHref(sde.uuid)} className="msc-arc-caption-link">Sky Direct Exposure</AtlasLink> goes straight to Sky. Cost of funds is the <AtlasLink to={atlasHref(toSky.uuid)} className="msc-arc-caption-link">amount due from {primeLabel} to Sky</AtlasLink>; SDE is an adjustment to the settlement.
        From Sky, round the bottom: the <AtlasLink to={atlasHref(fromSky.uuid)} className="msc-arc-caption-link">amount due from Sky to {primeLabel}</AtlasLink> (agent rate and distribution rewards){model.demandTotal !== model.demandMsc && ", plus other rewards Sky pays alongside, each linked to its own Atlas document"}. Both are settled in the <AtlasLink to={atlasHref(execVote.uuid)} className="msc-arc-caption-link">Sky Core Executive Vote</AtlasLink>, never netted. Figures are Soter Labs&rsquo;; muted ones have no Atlas term, striped is a loss.
        <AtlasGap due={due} primeLabel={primeLabel} />
      </figcaption>
      <SettlementVenueTable model={model} primeLabel={primeLabel} />
    </figure>
  );
}
