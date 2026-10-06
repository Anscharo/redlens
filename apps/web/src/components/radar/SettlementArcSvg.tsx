import { formatUsd } from "../../lib/settlements";
import type { StreamModel } from "@/lib/settlementStreams";
import { CX, CY, HEAD_FLARE, HEIGHT, INNER0, OUTER_END, WIDTH, type ArcBand, type ArcLayout, type LaneEnd } from "../../lib/settlementArcLayout";
import { ARC_OTHER_ID } from "../../lib/settlementArcRows";
import { ArcNodeLabels, PrimeBar, VenueLabels } from "./SettlementArcLabels";

/** Demand bands, kept and cost of funds wear their series' colour. */
const INK: Record<string, string> = {
  kept: "var(--msc-kept)",
  cof: "var(--msc-sky)",
  agentRate: "var(--msc-rate)",
  distributionRewards: "var(--msc-dr)",
  gar: "var(--msc-gar)",
  chroniclePoints: "var(--msc-cp)",
};
export const arcInk = (key: string) => INK[key] ?? "var(--msc-demand)";
const VENUE_SLOTS = 5;
const hash = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0);

/** Each drawn venue's colour from the --msc-venue-N categorical order. The
 *  colour follows the venue, not its rank: its slot is hashed from its id,
 *  and a clash moves the later id (in id order) to the next free slot, so a
 *  venue keeps its colour as it re-ranks. The folded tail is grey. */
export function venueInks(keys: string[]): Map<string, string> {
  const inks = new Map<string, string>();
  const taken = new Set<number>();
  for (const key of [...keys].sort()) {
    if (key === ARC_OTHER_ID) {
      inks.set(key, "var(--gray)");
      continue;
    }
    let slot = hash(key) % VENUE_SLOTS;
    for (let n = 0; taken.has(slot) && n < VENUE_SLOTS; n++) slot = (slot + 1) % VENUE_SLOTS;
    taken.add(slot);
    inks.set(key, `var(--msc-venue-${slot + 1})`);
  }
  return inks;
}
const LOSS = "url(#msc-arc-loss)";

/** One band: a hit area under it for its tooltip, then the band. A hairline
 *  of background between neighbours keeps them apart. */
function Band({ b, ink, venue, kind, title }: { b: ArcBand; ink: string; venue?: string; kind?: string; title: string }) {
  return (
    <g className="msc-arc-band" data-key={b.key} data-venue={venue} data-kind={kind}>
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

/** Sky as a bar under the right foot. Venues get no node: each is its own
 *  source, so each band starts on its own; the Prime is an outlined bar at
 *  the apex (PrimeBar), drawn over the pool it spans. */
function SkyFoot() {
  return <rect x={CX + INNER0 - HEAD_FLARE} y={CY + 2} width={OUTER_END - INNER0 + 2 * HEAD_FLARE} height={6} rx={2} className="msc-arc-sky" />;
}

/** The outer lane: venue revenue pooling at the Prime, cost of funds and
 *  kept (or the shortfall) leaving it, and SDE running past it to Sky. */
function OuterLane({ layout, model, prime, inks }: { layout: ArcLayout; model: StreamModel; prime: string; inks: Map<string, string> }) {
  const ink = (venue: string) => inks.get(venue) ?? "var(--gray)";
  const { cof, kept, shortfall } = layout;
  return (
    <g>
      {layout.revenue.map((v) => <Band key={v.key} b={v} ink={ink(v.venue)} venue={v.venue} kind="revenue" title={`${v.label}: ${formatUsd(v.value)} revenue to ${prime}`} />)}
      <Lane lane={layout.lanes.revenue} ink="var(--tan-3)" />
      {shortfall && <Band b={shortfall} ink={arcInk("kept")} title={`Cost of funds exceeded venue revenue by ${formatUsd(-shortfall.value)}; ${prime} covers the difference`} />}
      {layout.sde.map((v) => <Band key={v.key} b={v} ink={ink(v.venue)} venue={v.venue} kind="sde" title={`${v.label}: ${formatUsd(v.value)} Sky Direct Exposure, straight to Sky`} />)}
      <Lane lane={layout.lanes.sde} ink="var(--msc-sky)" />
      {cof && <Band b={cof} ink={arcInk("cof")} title={`${prime} pays Sky ${formatUsd(cof.value)} cost of funds on the USDS it borrowed`} />}
      <Lane lane={layout.lanes.cof} ink="var(--msc-sky)" />
      {kept && <Band b={kept} ink={arcInk("kept")} title={`${prime} keeps ${formatUsd(model.kept)}: its venue revenue less cost of funds`} />}
    </g>
  );
}

export function SettlementArcSvg({ layout, model, primeLabel, month, inks }: { layout: ArcLayout; model: StreamModel; primeLabel: string; month?: string; inks: Map<string, string> }) {
  const { demand } = layout;
  const demandLabel = (key: string) => model.demand.find((d) => d.key === key)?.label ?? key;
  return (
    <svg className="msc-arc" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby="msc-arc-title msc-arc-desc">
      <title id="msc-arc-title">{`${primeLabel}'s settlement arc`}</title>
      <desc id="msc-arc-desc">
        {`Clockwise on the outer arc, venue revenue of ${formatUsd(model.revenue)} pools at ${primeLabel}, which pays Sky ${formatUsd(model.cof)} cost of funds and keeps ${formatUsd(model.kept)}; ${formatUsd(model.sde)} of Sky Direct Exposure goes past ${primeLabel} straight to Sky, ${formatUsd(model.toSky)} to Sky in all. Counterclockwise on the inner arc, Sky owes ${primeLabel} ${formatUsd(model.demandTotal)} on the demand side. The two amounts are never netted.`}
      </desc>
      <defs>
        <pattern id="msc-arc-loss" patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
          <rect width={3} height={6} style={{ fill: "var(--msc-loss)" }} />
        </pattern>
      </defs>
      <SkyFoot />
      {demand.map((b) => <Band key={b.key} b={b} ink={arcInk(b.key)} title={`${demandLabel(b.key)}: ${formatUsd(b.value)} from Sky to ${primeLabel}`} />)}
      <Lane lane={layout.lanes.demand} ink={arcInk(demand[0]?.key ?? "")} />
      <OuterLane layout={layout} model={model} prime={primeLabel} inks={inks} />
      <PrimeBar span={layout.prime} model={model} primeLabel={primeLabel} />
      <VenueLabels venues={[...layout.revenue, ...layout.sde]} />
      <ArcNodeLabels model={model} primeLabel={primeLabel} month={month} />
    </svg>
  );
}
