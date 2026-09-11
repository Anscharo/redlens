import { useEffect, useMemo, useRef, useState } from "react";
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
import { DIM } from "./MscRingHoverStyles";
import { RingKey } from "./MscRingKey";
import { MscChartStyle, type ChartStyle } from "./MscChartStyle";
import { MscTimeseries, primeFill } from "./MscTimeseries";

const mscCodec = urlString(null);
/** Chart style: the three-stage flow (default, no param) or the orbital pies. */
const viewCodec = urlString(null);
const SOURCE = "https://github.com/soterlabs/settlement-reports";
/** Autoplay dwell per month. */
const PLAY_MS = 1000;

export function MscOverview({ actors }: { actors: OverviewActor[] }) {
  const bundle = useLoaded(loadSettlements, { soft: true });
  const months = useMemo(() => (bundle ? settlementMonths(bundle) : []), [bundle]);
  const latest = months[months.length - 1] ?? null;
  const [msc, setMsc] = useUrlState("msc", mscCodec);
  const month = months.includes(msc ?? "") ? msc! : latest;
  // Playback steps through the months, PLAY_MS each, looping. Opt-in: the
  // page opens paused on the latest month (or ?msc); any click on a month
  // column pauses it again.
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing || months.length < 2 || !month) return;
    const id = setInterval(() => {
      const next = months[(months.indexOf(month) + 1) % months.length];
      setMsc(next === latest ? null : next);
    }, PLAY_MS);
    return () => clearInterval(id);
  }, [playing, months, month, latest, setMsc]);

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
  const [viewParam, setViewParam] = useUrlState("view", viewCodec);
  const view: ChartStyle = viewParam === "orbit" ? "orbit" : "flow";
  // What both charts know about a Prime: its label, link and identity
  // color (the same as its timeseries layers, by stack order).
  const overviewPrimes = useMemo<OverviewPrime[]>(
    () =>
      flows.map((flow) => {
        const actor = actorForPrimeKey(flow.prime, actors);
        const to = actor
          ? settlementsHref(actor.slug) + (month !== flow.latestMonth ? `?msc=${month}` : "")
          : null;
        return { flow, label: labelOf(flow.prime), bandColor: primeFill(stack.primes.indexOf(flow.prime)), to };
      }),
    [flows, actors, month, labelOf, stack.primes],
  );
  const layout = useMemo(() => layoutMscRing(flows, labelOf), [flows, labelOf]);
  const flowLayout = useMemo(() => (view === "flow" ? layoutMscFlow(flows) : null), [view, flows]);
  const ringPrimes = useMemo<MscRingPrime[]>(
    () => layout.primes.map((ring) => ({ ...overviewPrimes.find((p) => p.flow.prime === ring.prime)!, ring })),
    [layout, overviewPrimes],
  );
  const eco = useMemo(
    () => (bundle && month ? ecosystemThreeWay(bundle, month) : null),
    [bundle, month],
  );

  const viewed = useRef(false);
  const ready = Boolean(bundle && !settlementsArtifactMissing(bundle) && month && eco && flows.length > 0);
  useEffect(() => {
    if (!ready || viewed.current) return;
    viewed.current = true;
    track("msc_overview_view", { month: month!, primes: flows.length });
  }, [ready, month, flows.length]);

  if (!bundle || settlementsArtifactMissing(bundle) || !month || !eco) return null;

  return (
    <section className="px-6 pt-4">
      <h2 className="text-xl mb-3" style={{ color: "var(--tan)" }}>
        Monthly Settlement Cycle
      </h2>
      <p className="text-xs mb-4 max-w-3xl" style={{ color: "var(--tan-3)" }}>
        Soter Labs' Monthly Settlement Cycle workbooks (OEA calculations, not
        Atlas figures). “To Sky” is what Primes owed Sky, not the Protocol's Net
        Revenue (A.2.3.1.2.1.1).{" "}
        <a href={SOURCE} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
          Source workbooks
        </a>
      </p>
      <MscHeadline eco={eco} />
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
              setPlaying(false);
              setMsc(m === latest ? null : m);
            }}
            playing={playing}
            onTogglePlay={() => setPlaying((p) => !p)}
          />
        </div>
        <div className="msc-card msc-ring-card rounded p-4 flex-1 min-w-0 flex flex-col" style={{ flexBasis: 340, maxWidth: "100%" }}>
          <p className="text-sm mb-2 flex flex-wrap items-center gap-3" style={{ color: "var(--tan)" }}>
            <span>Sky System Settlements — {formatMonth(month)}</span>
            <MscChartStyle
              value={view}
              onChange={(v) => {
                setViewParam(v === "flow" ? null : v);
                track("msc_overview_style", { view: v });
              }}
            />
          </p>
          {flowLayout ? (
            <MscFlow layout={flowLayout} primes={overviewPrimes} month={month} centerFigure={formatUsd(eco.sky, true)} />
          ) : (
            <MscRing layout={layout} primes={ringPrimes} month={month} centerFigure={formatUsd(eco.sky, true)} />
          )}
          <RingKey view={view} />
        </div>
      </div>
    </section>
  );
}

/* Cross-chart hover: a To-Sky segment in the SELECTED month lights the
   same money on the ring (that prime's To-Sky slices, arrow and Sky
   wedge), and the ring's To-Sky marks light the segment back. Other months' layers describe
   different numbers than the ring shows, so they don't. Either way the
   rest of the other chart fades to DIM, so the pairing is unmistakable
   rather than an outline you have to look for. Static CSS can't express
   "same data-prime as the hovered element", so the rules are generated per
   prime — the same trick as the venue sankey's VenueHoverStyles. */
function PrimeHoverStyles({ primes }: { primes: string[] }) {
  const css = primes
    .map((p) => {
      const seg = (flow: string) =>
        `.msc-overview-row:has(.msc-bar-col[data-active="true"] .msc-ts-seg[data-prime="${p}"][data-flow="${flow}"]:hover)`;
      const prime = `.msc-ring-prime[data-prime="${p}"]`;
      const mark = (kinds: string[]) =>
        `.msc-overview-row:has(${kinds.map((k) => `.msc-ring-mark[data-mark="${p}::${k}"]:hover`).join(", ")})`;
      const layer = (flow: string) =>
        `.msc-bar-col[data-active="true"] .msc-ts-seg[data-prime="${p}"][data-flow="${flow}"]`;
      // Lit marks get an outline in the text ink (fills never change, so
      // the audited fill/ink pairs hold at rest and when lit).
      const lit = "{ opacity: 1; stroke: var(--tan); stroke-width: 2.5; }";
      // Everything on the ring that is not prime p.
      const ringOthers = `.msc-ring :is(.msc-ring-prime:not([data-prime="${p}"]), .msc-ring-sky-disc, .msc-ring-sky-wedge:not([data-prime="${p}"]), .msc-ring-figure[data-kind="sky"]:not([data-prime="${p}"]))`;
      // Every segment of the selected month that is not prime p's.
      const colOthers = `.msc-bar-col[data-active="true"] .msc-ts-seg:not([data-prime="${p}"])`;
      return [
        // Timeseries → ring: a To-Sky segment = the two To-Sky slices, the
        // arrow and the wedge of that Prime.
        `${seg("sky")} ${ringOthers} { opacity: ${DIM}; }`,
        `${seg("sky")} ${prime} .msc-ring-label { fill: var(--tan); }`,
        `${seg("sky")} ${prime} :is(.msc-ring-cof, .msc-ring-sde, .msc-ring-arrow) ${lit}`,
        `${seg("sky")} .msc-ring-sky-wedge[data-prime="${p}"] ${lit}`,
        // Ring → timeseries: the prime's pie (or its wedge) in focus fades
        // the month's other primes; the To-Sky marks name its segment.
        `.msc-overview-row:has(${prime}:hover, .msc-ring-mark[data-mark="${p}::share"]:hover) ${colOthers} { opacity: ${DIM}; }`,
        `${mark(["cof", "sde", "sky", "share"])} ${layer("sky")} { outline: 2px solid var(--tan); outline-offset: -2px; }`,
      ].join("\n");
    })
    .join("\n");
  return <style>{css}</style>;
}
