import { Suspense, use, useEffect, useMemo, useRef, useState } from "react";
import { useUrlState, urlString } from "../../hooks/useUrlState";
import {
  loadSettlements,
  formatMonth,
  formatUsd,
  cycleWindow,
  settlementsArtifactMissing,
} from "../../lib/settlements";
import {
  actorForPrimeKey,
  ecosystemThreeWay,
  primeFlowsForMonth,
  primeStackMonths,
  settlementMonths,
  type OverviewActor,
} from "@/lib/settlementsOverview";
import { settlementsHref } from "@/lib/routes";
import { layoutMscRing } from "../../lib/mscOverviewLayout";
import { layoutMscFlow } from "../../lib/mscFlowLayout";
import { track } from "../../lib/analytics";
import { MscHeadline } from "./MscHeadline";
import { MscRing, type MscRingPrime } from "./MscRing";
import { MscFlow } from "./MscFlow";
import type { OverviewPrime } from "./MscRingPrime";
import { RingKey } from "./MscRingKey";
import { PrimeHoverStyles } from "./MscPrimeHoverStyles";
import { MscChartStyle, type ChartStyle } from "./MscChartStyle";
import { MscZoomReset } from "./MscZoomReset";
import { MscTimeseries, primeFill } from "./MscTimeseries";
import { MscOverviewSkeleton, OverviewIntro } from "./MscOverviewSkeleton";
import { useMonthAutoplay } from "../../hooks/useMonthAutoplay";
import { useTweened } from "../../hooks/useTweened";
import { tweenPrimeFlows } from "../../lib/mscTween";

const mscCodec = urlString(null);
/** Chart style: the three-stage sankey (default, no param) or the pies. */
const viewCodec = urlString(null);
/** The cross-Prime Monthly Settlement Cycle section. Suspends on the
 *  settlements artifact behind a skeleton of the same cards at the same
 *  sizes (MscOverviewSkeleton), so the charts paint into place. */
export function MscOverview({ actors }: { actors: OverviewActor[] }) {
  return (
    <Suspense fallback={<MscOverviewSkeleton />}>
      <MscOverviewLoaded actors={actors} />
    </Suspense>
  );
}

function MscOverviewLoaded({ actors }: { actors: OverviewActor[] }) {
  const bundle = use(loadSettlements());
  // The trailing year of cycles: what the timeseries shows and what the
  // month selector, autoplay and arrow keys step through.
  const months = useMemo(() => (bundle ? cycleWindow(settlementMonths(bundle)).rows : []), [bundle]);
  const latest = months[months.length - 1] ?? null;
  const [msc, setMsc] = useUrlState("msc", mscCodec);
  const month = months.includes(msc ?? "") ? msc! : latest;
  const play = useMonthAutoplay(months, month, latest, setMsc);

  const labelOf = useMemo(
    () => (prime: string) =>
      actorForPrimeKey(prime, actors)?.name ?? prime.charAt(0).toUpperCase() + prime.slice(1),
    [actors],
  );
  const stack = useMemo(() => {
    const all = bundle ? primeStackMonths(bundle) : { primes: [], months: [] };
    return { primes: all.primes, months: all.months.filter((m) => months.includes(m.month)) };
  }, [bundle, months]);
  const flows = useMemo(
    () => (bundle && month ? primeFlowsForMonth(bundle, month) : []),
    [bundle, month],
  );
  // The pies lay themselves out from the rows each render, so a month
  // change is drawn by tweening the rows (the sankey tweens its own layout).
  const drawnFlows = useTweened(flows, tweenPrimeFlows);
  const [viewParam, setViewParam] = useUrlState("view", viewCodec);
  const view: ChartStyle = viewParam === "pies" ? "pies" : "sankey";
  // What both charts know about a Prime: its label, link and identity
  // color (the same as its timeseries layers, by stack order).
  const overviewPrimes = useMemo<OverviewPrime[]>(
    () =>
      drawnFlows.map((flow) => {
        const actor = actorForPrimeKey(flow.prime, actors);
        const to = actor
          ? settlementsHref(actor.slug) + (month !== flow.latestMonth ? `?msc=${month}` : "")
          : null;
        return { flow, label: labelOf(flow.prime), bandColor: primeFill(stack.primes.indexOf(flow.prime)), to };
      }),
    [drawnFlows, actors, month, labelOf, stack.primes],
  );
  const layout = useMemo(() => layoutMscRing(drawnFlows, labelOf), [drawnFlows, labelOf]);
  const flowLayout = useMemo(() => (view === "sankey" ? layoutMscFlow(flows) : null), [view, flows]);
  const ringPrimes = useMemo<MscRingPrime[]>(
    () => layout.primes.map((ring) => ({ ...overviewPrimes.find((p) => p.flow.prime === ring.prime)!, ring })),
    [layout, overviewPrimes],
  );
  const eco = useMemo(
    () => (bundle && month ? ecosystemThreeWay(bundle, month) : null),
    [bundle, month],
  );

  // Reported up by whichever chart is mounted, so the reset control can
  // live in the title row; null again as soon as that chart unmounts.
  const [zoom, setZoom] = useState<{ zoomed: boolean; reset: () => void } | null>(null);

  const viewed = useRef(false);
  const ready = Boolean(!settlementsArtifactMissing(bundle) && month && eco && flows.length > 0);
  useEffect(() => {
    if (!ready || viewed.current) return;
    viewed.current = true;
    track("msc_overview_view", { month: month!, primes: flows.length });
  }, [ready, month, flows.length]);

  if (settlementsArtifactMissing(bundle) || !month || !eco) return null;

  return (
    <OverviewIntro>
      <MscHeadline eco={eco} month={month} play={{ playing: play.playing, onToggle: play.toggle }} />
      <PrimeHoverStyles primes={stack.primes} />
      {/* The timeseries card sets the row's height; the ring card stretches
          to match and its chart fills whatever is left under the title and
          above the key. */}
      <div className="msc-overview-row flex flex-wrap items-stretch gap-x-6 gap-y-4 min-w-0">
        <div className="msc-card rounded p-4 min-w-0 max-w-full">
          <MscTimeseries
            primes={stack.primes}
            months={stack.months}
            primeLabel={labelOf}
            selected={month}
            onSelect={(m) => {
              play.pause();
              setMsc(m === latest ? null : m);
            }}
          />
        </div>
        <div className="msc-card msc-ring-card rounded p-4 flex-1 min-w-0 flex flex-col" style={{ flexBasis: 340, maxWidth: "100%" }}>
          <p className="text-sm mb-2 flex flex-wrap items-center gap-3" style={{ color: "var(--tan)" }}>
            <span>Sky System Settlements — {formatMonth(month)}</span>
            <MscChartStyle
              value={view}
              onChange={(v) => {
                setViewParam(v === "sankey" ? null : v);
                track("msc_overview_style", { view: v });
              }}
            />
            {/* The way out of a zoomed chart sits here, at the end of the
                title row, rather than floating over the drawing it undoes.
                The chart still owns its zoom and only reports it up. */}
            {zoom?.zoomed && (
              <span className="ml-auto">
                <MscZoomReset onReset={zoom.reset} />
              </span>
            )}
          </p>
          {flowLayout ? (
            <MscFlow layout={flowLayout} primes={overviewPrimes} month={month} centerFigure={formatUsd(eco.sky, true)} onZoom={setZoom} />
          ) : (
            <MscRing layout={layout} primes={ringPrimes} month={month} centerFigure={formatUsd(eco.sky, true)} onZoom={setZoom} />
          )}
          <RingKey view={view} />
        </div>
      </div>
    </OverviewIntro>
  );
}
