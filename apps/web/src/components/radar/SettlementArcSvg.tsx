import { formatUsd } from "../../lib/settlements";
import type { StreamModel } from "@/lib/settlementStreams";
import { CX, CY, HEAD_FLARE, HEIGHT, INNER0, OUTER0, OUTER_END, PRIME_HALF, WIDTH, type ArcBand, type ArcLayout, type Stripe } from "../../lib/settlementArcLayout";
import { ArcNodeLabels, VenueLabels } from "./SettlementArcLabels";

/** Each stripe wears the colour of what it carries; a negative one wears
 *  the loss stripes instead. */
const INK: Record<string, string> = {
  kept: "var(--msc-kept)",
  cof: "var(--msc-sky)",
  sde: "var(--msc-sde)",
  agentRate: "var(--msc-rate)",
  distributionRewards: "var(--msc-dr)",
  gar: "var(--msc-gar)",
  chroniclePoints: "var(--msc-cp)",
};
export const arcInk = (key: string) => INK[key] ?? "var(--msc-demand)";
const LOSS = "url(#msc-arc-loss)";

/** One payment: a hit area, the band, its arrowhead, and the moving dashes
 *  that show which way it runs (stilled under reduced motion). */
function Band({ b, ink, venue, title }: { b: ArcBand; ink: string; venue?: string; title: string }) {
  const fill = b.loss ? LOSS : ink;
  return (
    <g className="msc-arc-band" data-key={b.key} data-venue={venue}>
      <title>{title}</title>
      <path d={b.d} className="msc-arc-hit" strokeWidth={Math.max(b.w, 10)} />
      <path d={b.d} className="msc-arc-body" stroke={fill} strokeWidth={b.w} />
      {b.head && <path d={b.head} fill={fill} />}
      <path d={b.d} className="msc-arc-flow" strokeWidth={Math.min(3, Math.max(1, b.w * 0.35))} />
    </g>
  );
}

function stripeTitle(s: Stripe, model: StreamModel, prime: string): string {
  const venue = model.venues.find((v) => v.id === s.venue)?.label ?? s.venue;
  const amt = formatUsd(Math.abs(s.value));
  if (s.part === "kept") return s.loss ? `${venue}: ${prime} paid ${amt} more cost of funds than it earned here` : `${venue}: ${amt} kept by ${prime}`;
  if (s.part === "cof") return `${venue}: ${s.loss ? `a ${amt} refund of` : amt} cost of funds, through ${prime} to Sky`;
  return `${venue}: ${amt} Sky Direct Exposure, passing through ${prime} to Sky`;
}

/** The three nodes: Venues and Sky as bars under the feet, the Prime as a
 *  bar across the apex that the venue stripes run through. */
function Nodes() {
  return (
    <g>
      <rect x={CX - OUTER_END - HEAD_FLARE} y={CY + 2} width={OUTER_END - OUTER0 + 2 * HEAD_FLARE} height={8} rx={2} className="msc-arc-node" />
      <rect x={CX + INNER0 - HEAD_FLARE} y={CY + 2} width={OUTER_END - INNER0 + 2 * HEAD_FLARE} height={8} rx={2} className="msc-arc-sky" />
      <rect x={CX - PRIME_HALF} y={CY - OUTER_END - 4} width={PRIME_HALF * 2} height={OUTER_END - INNER0 + 8} rx={3} className="msc-arc-prime" />
    </g>
  );
}

export function SettlementArcSvg({ layout, model, primeLabel, month }: { layout: ArcLayout; model: StreamModel; primeLabel: string; month?: string }) {
  const demandLabel = (key: string) => model.demand.find((d) => d.key === key)?.label ?? key;
  return (
    <svg className="msc-arc" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby="msc-arc-title msc-arc-desc">
      <title id="msc-arc-title">{`${primeLabel}'s settlement arc`}</title>
      <desc id="msc-arc-desc">
        {`Clockwise on the outer arc, each venue's revenue runs from the venues to ${primeLabel}; ${formatUsd(model.kept)} stays there, while cost of funds ${formatUsd(model.cof)} and Sky Direct Exposure ${formatUsd(model.sde)} pass through to Sky, ${formatUsd(model.toSky)} in all. Counterclockwise on the inner arc, Sky owes ${primeLabel} ${formatUsd(model.demandTotal)} on the demand side. The two amounts are never netted.`}
      </desc>
      <defs>
        <pattern id="msc-arc-loss" patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
          <rect width={3} height={6} style={{ fill: "var(--msc-loss)" }} />
        </pattern>
      </defs>
      <Nodes />
      {layout.demand.map((b) => <Band key={b.key} b={b} ink={arcInk(b.key)} title={`${demandLabel(b.key)}: ${formatUsd(b.value)} from Sky to ${primeLabel}`} />)}
      {layout.stripes.map((s) => <Band key={s.key} b={s} ink={arcInk(s.part)} venue={s.venue} title={stripeTitle(s, model, primeLabel)} />)}
      <VenueLabels labels={layout.venueLabels} />
      <ArcNodeLabels model={model} primeLabel={primeLabel} month={month} />
    </svg>
  );
}
