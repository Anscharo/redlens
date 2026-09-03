import { useMemo, useRef } from "react";
import { useLoaded } from "../../hooks/useAtlasData";
import { useUrlState, urlString } from "../../hooks/useUrlState";
import {
  loadSettlements,
  formatMonth,
  formatUsd,
  settlementsArtifactMissing,
} from "../../lib/settlements";
import {
  actorForPrimeKey,
  ecosystemHeadlineFigures,
  ecosystemThreeWay,
  primeFlowsForMonth,
  primeStackMonths,
  settlementMonths,
  type OverviewActor,
} from "@/lib/settlementsOverview";
import { settlementsHref } from "@/lib/routes";
import { layoutMscRing } from "../../lib/mscOverviewLayout";
import { track } from "../../lib/analytics";
import { SettlementFigure } from "./SettlementFigures";
import { MscRing, type MscRingPrime } from "./MscRing";
import { MscTimeseries, primeFill } from "./MscTimeseries";

const mscCodec = urlString(null);
const SOURCE = "https://github.com/soterlabs/settlement-reports";

export function MscOverview({ actors }: { actors: OverviewActor[] }) {
  const bundle = useLoaded(loadSettlements, { soft: true });
  const months = useMemo(() => (bundle ? settlementMonths(bundle) : []), [bundle]);
  const latest = months[months.length - 1] ?? null;
  const [msc, setMsc] = useUrlState("msc", mscCodec);
  const month = months.includes(msc ?? "") ? msc! : latest;

  const labelOf = useMemo(
    () => (prime: string) =>
      actorForPrimeKey(prime, actors)?.name ?? prime.charAt(0).toUpperCase() + prime.slice(1),
    [actors],
  );
  const stack = useMemo(
    () => (bundle ? primeStackMonths(bundle) : { primes: [], months: [] }),
    [bundle],
  );
  const flows = useMemo(
    () => (bundle && month ? primeFlowsForMonth(bundle, month) : []),
    [bundle, month],
  );
  const layout = useMemo(() => layoutMscRing(flows, labelOf), [flows, labelOf]);
  const ringPrimes = useMemo<MscRingPrime[]>(
    () =>
      layout.primes.map((ring) => {
        const flow = flows.find((f) => f.prime === ring.prime)!;
        const actor = actorForPrimeKey(flow.prime, actors);
        const to = actor
          ? settlementsHref(actor.slug) + (month !== flow.latestMonth ? `?msc=${month}` : "")
          : null;
        // Same identity color as the prime's timeseries layers (stack order).
        const bandColor = primeFill(stack.primes.indexOf(flow.prime));
        return { flow, ring, label: labelOf(flow.prime), bandColor, to };
      }),
    [layout, flows, actors, month, labelOf, stack.primes],
  );
  const eco = useMemo(
    () => (bundle && month ? ecosystemThreeWay(bundle, month) : null),
    [bundle, month],
  );

  const viewed = useRef(false);
  if (!viewed.current && month && flows.length > 0) {
    viewed.current = true;
    track("msc_overview_view", { month, primes: flows.length });
  }

  if (!bundle || settlementsArtifactMissing(bundle) || !month || !eco) return null;

  return (
    <section className="px-6 pt-4">
      <h2 className="text-xl mb-3" style={{ color: "var(--tan)" }}>
        Monthly Settlement Cycle
      </h2>
      <p className="text-xs mb-4 max-w-3xl" style={{ color: "var(--tan-3)" }}>
        From Soter Labs' published Monthly Settlement Cycle workbooks — OEA
        calculations, not the on-chain GovOps spell and not Sky Atlas figures.
        “To Sky” totals are what the Primes owed Sky, not the Protocol's Net
        Revenue, which the Atlas defines as income minus expenses
        (A.2.3.1.2.1.1).{" "}
        <a href={SOURCE} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
          Source workbooks
        </a>
      </p>
      <div className="flex flex-wrap gap-x-6 gap-y-1 mb-4 text-sm">
        {ecosystemHeadlineFigures(eco).map((f) => (
          <SettlementFigure key={f.label} {...f} />
        ))}
      </div>
      <PrimeHoverStyles primes={stack.primes} />
      <div className="msc-overview-row flex flex-wrap items-start gap-x-6 gap-y-4 min-w-0">
        <div className="msc-card rounded p-4 min-w-0 max-w-full">
          <MscTimeseries
            primes={stack.primes}
            months={stack.months}
            primeLabel={labelOf}
            selected={month}
            onSelect={(m) => setMsc(m === latest ? null : m)}
          />
        </div>
        <div className="msc-card msc-ring-card rounded p-4 flex-1 min-w-0" style={{ flexBasis: 340, maxWidth: "100%" }}>
          <p className="text-sm mb-2" style={{ color: "var(--tan)" }}>
            Sky Ecosystem — {formatMonth(month)}
          </p>
          <MscRing
            layout={layout}
            primes={ringPrimes}
            month={month}
            centerFigure={formatUsd(eco.sky, true)}
          />
          <RingKey />
        </div>
      </div>
    </section>
  );
}

/* Hovering a prime's segment in the SELECTED month lights that prime up on
   the ring (other months' segments describe different numbers than the ring
   shows, so they don't). Static CSS can't express "same data-prime as the
   hovered segment", so one :has() rule per prime is generated — the same
   trick as the venue sankey's VenueHoverStyles. */
function PrimeHoverStyles({ primes }: { primes: string[] }) {
  const css = primes
    .map((p) => {
      const row = `.msc-overview-row:has(.msc-bar-col[data-active="true"] .msc-ts-seg[data-prime="${p}"]:hover)`;
      const sel = `${row} .msc-ring-prime[data-prime="${p}"]`;
      // The prime's own wedge inside Sky lights with it — it sits outside
      // the prime's group, so it needs its own rule. Pills stay hidden here:
      // this highlight names a prime, not one figure.
      return [
        `${sel} :is(path, rect, line, circle) { opacity: 1; }`,
        `${sel} .msc-ring-label { fill: var(--tan); }`,
        `${row} .msc-ring-sky-wedge[data-prime="${p}"] { fill-opacity: 1; }`,
      ].join("\n");
    })
    .join("\n");
  return <style>{css}</style>;
}

function RingKey() {
  const swatch = (background: string) => (
    <span className="inline-block w-2 h-2 mr-1 align-middle" style={{ background }} />
  );
  return (
    <div className="mono text-[10px] mt-5" style={{ color: "var(--tan-3)" }}>
      <p className="flex flex-wrap gap-x-4 gap-y-1 justify-center">
        <span className="msc-key-item" data-key="sky">{swatch("var(--msc-sky)")} to Sky</span>
        <span className="msc-key-item" data-key="kept">{swatch("var(--msc-kept)")} supply kept by Primes</span>
        <span className="msc-key-item" data-key="neg">
          {swatch(
            "repeating-linear-gradient(45deg, var(--msc-kept) 0, var(--msc-kept) 2px, transparent 2px, transparent 4px)",
          )}
          supply loss to Primes
        </span>
        <span className="msc-key-item" data-key="demand">{swatch("var(--msc-demand)")} demand-side to Primes</span>
      </p>
      <p className="text-center mt-1">
        Circle size is the Prime's production*; the bar inside is what it
        kept, on one square-root scale; the donut is the To-Sky total by
        Prime. *Production = To Sky + supply kept + demand-side. Hover for
        figures; click a Prime to open its settlement page.
      </p>
    </div>
  );
}
