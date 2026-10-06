import { formatUsd } from "../../lib/settlements";
import type { StreamModel } from "@/lib/settlementStreams";
import { ARC_OTHER_ID, CX, CY, HEAD_FLARE, HEIGHT, INNER0, OUTER0, OUTER_END, WIDTH, type ArcBand, type ArcLayout, type LaneEnd, type VenueBand } from "../../lib/settlementArcLayout";
import { ArcNodeLabels, PrimeBar, VenueLabels } from "./SettlementArcLabels";
import { venueFill } from "./SettlementAum";

/** Demand bands and kept wear their series' colour. */
const INK: Record<string, string> = {
  kept: "var(--msc-kept)",
  agentRate: "var(--msc-rate)",
  distributionRewards: "var(--msc-dr)",
  gar: "var(--msc-gar)",
  chroniclePoints: "var(--msc-cp)",
};
export const arcInk = (key: string) => INK[key] ?? "var(--msc-demand)";
/** A venue wears the same colour here as on the AUM view (venueFill). */
export const venueInk = (key: string) => venueFill(key === ARC_OTHER_ID ? "_other" : key);
const LOSS = "url(#msc-arc-loss)";

/** One band: a hit area under it for its tooltip, then the band. A hairline
 *  of background between neighbours keeps them apart. */
function Band({ b, ink, venue, title }: { b: ArcBand; ink: string; venue?: string; title: string }) {
  return (
    <g className="msc-arc-band" data-key={b.key} data-venue={venue}>
      <title>{title}</title>
      <path d={b.d} className="msc-arc-hit" strokeWidth={Math.max(b.w, 10)} />
      <path d={b.d} className="msc-arc-body" stroke={b.loss ? LOSS : ink} strokeWidth={Math.max(1, b.w - 0.75)} />
    </g>
  );
}

/** A lane's one arrowhead and the dashes running along its middle (stilled
 *  under reduced motion). */
function Lane({ lane, ink }: { lane: LaneEnd | null; ink: string }) {
  if (!lane) return null;
  return (
    <g>
      <path d={lane.head} fill={ink} />
      <path d={lane.flow} className="msc-arc-flow" strokeWidth={Math.min(3, Math.max(1, lane.w * 0.08))} />
    </g>
  );
}

function venueTitle(v: VenueBand, prime: string): string {
  const parts = [v.cof && `cost of funds ${formatUsd(v.cof)}`, v.sde && `Sky Direct Exposure ${formatUsd(v.sde)}`].filter(Boolean).join(" + ");
  return `${v.label}: ${formatUsd(v.value)} through ${prime} to Sky (${parts})`;
}

/** Venues and Sky as bars under the feet; the Prime is an outlined bar at
 *  the apex (PrimeBar), drawn over the bands it spans. */
function Feet() {
  return (
    <g>
      <rect x={CX - OUTER_END - HEAD_FLARE} y={CY + 2} width={OUTER_END - OUTER0 + 2 * HEAD_FLARE} height={6} rx={2} className="msc-arc-node" />
      <rect x={CX + INNER0 - HEAD_FLARE} y={CY + 2} width={OUTER_END - INNER0 + 2 * HEAD_FLARE} height={6} rx={2} className="msc-arc-sky" />
    </g>
  );
}

export function SettlementArcSvg({ layout, model, primeLabel, month }: { layout: ArcLayout; model: StreamModel; primeLabel: string; month?: string }) {
  const { kept, venues, demand } = layout;
  const demandLabel = (key: string) => model.demand.find((d) => d.key === key)?.label ?? key;
  return (
    <svg className="msc-arc" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby="msc-arc-title msc-arc-desc">
      <title id="msc-arc-title">{`${primeLabel}'s settlement arc`}</title>
      <desc id="msc-arc-desc">
        {`Clockwise on the outer arc, venue revenue runs into ${primeLabel}; ${formatUsd(model.kept)} stays there, while each venue's cost of funds and Sky Direct Exposure pass through to Sky, ${formatUsd(model.toSky)} in all. Counterclockwise on the inner arc, Sky owes ${primeLabel} ${formatUsd(model.demandTotal)} on the demand side. The two amounts are never netted.`}
      </desc>
      <defs>
        <pattern id="msc-arc-loss" patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
          <rect width={3} height={6} style={{ fill: "var(--msc-loss)" }} />
        </pattern>
      </defs>
      <Feet />
      {demand.map((b) => <Band key={b.key} b={b} ink={arcInk(b.key)} title={`${demandLabel(b.key)}: ${formatUsd(b.value)} from Sky to ${primeLabel}`} />)}
      <Lane lane={layout.inner} ink={arcInk(demand[0]?.key ?? "")} />
      {kept && <Band b={kept} ink={arcInk("kept")} title={kept.loss ? `${primeLabel} paid ${formatUsd(-kept.value)} more cost of funds than its venues earned` : `${formatUsd(kept.value)} of venue revenue stays with ${primeLabel}`} />}
      {venues.map((v) => <Band key={v.key} b={v} ink={venueInk(v.key)} venue={v.key} title={venueTitle(v, primeLabel)} />)}
      <Lane lane={layout.outer} ink="var(--msc-sky)" />
      <PrimeBar span={layout.prime} model={model} primeLabel={primeLabel} />
      <VenueLabels venues={venues} />
      <ArcNodeLabels model={model} primeLabel={primeLabel} month={month} />
    </svg>
  );
}
