import { useEffect, useMemo, useRef, useState } from "react";
import { useLoaded } from "../../hooks/useAtlasData";
import { useUrlState, urlString } from "../../hooks/useUrlState";
import {
  DEMAND_SERIES,
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
import { track } from "../../lib/analytics";
import { MscHeadline } from "./MscHeadline";
import { MscRing, type MscRingPrime } from "./MscRing";
import { SLICE_CODE, SLICE_TOKEN } from "./MscRingPills";
import { MscTimeseries, primeFill } from "./MscTimeseries";

const mscCodec = urlString(null);
const SOURCE = "https://github.com/soterlabs/settlement-reports";
/** Autoplay dwell per month. */
const PLAY_MS = 1000;

export function MscOverview({ actors }: { actors: OverviewActor[] }) {
  const bundle = useLoaded(loadSettlements, { soft: true });
  const months = useMemo(() => (bundle ? settlementMonths(bundle) : []), [bundle]);
  const latest = months[months.length - 1] ?? null;
  const [msc, setMsc] = useUrlState("msc", mscCodec);
  const month = months.includes(msc ?? "") ? msc! : latest;
  // Autoplay: step through the months, PLAY_MS each, looping. On by default
  // unless the page was opened on a specific month (?msc) or the visitor
  // prefers reduced motion; any click on a month column stops it.
  const [playing, setPlaying] = useState(
    () => msc == null && !(typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches),
  );
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
          <p className="text-sm mb-2" style={{ color: "var(--tan)" }}>
            Sky System Settlements — {formatMonth(month)}
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

/* Cross-chart hover, per FLOW not per prime: a timeseries layer in the
   SELECTED month lights the same money on the ring (a kept layer → that
   prime's bar and plate; a To-Sky layer → its arrow and Sky wedge), and the
   ring's marks light the matching layer back. Other months' layers describe
   different numbers than the ring shows, so they don't. Static CSS can't
   express "same data-prime as the hovered element", so the rules are
   generated per prime — the same trick as the venue sankey's
   VenueHoverStyles. */
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
      const keptKinds = ["kept", ...DEMAND_SERIES.map((s) => s.key)];
      // Lit marks get an outline in the text ink (fills never change, so
      // the audited fill/ink pairs hold in every state).
      const lit = "{ opacity: 1; stroke: var(--tan); stroke-width: 2; }";
      return [
        // Timeseries → ring. A kept layer = supply kept + demand-side slices
        // (+ the loss hole); a To-Sky layer = the two To-Sky slices, the
        // arrow and the wedge.
        `${seg("kept")} ${prime} :is(${keptKinds.map((k) => `.msc-ring-${k}`).join(", ")}, .msc-ring-hole) ${lit}`,
        `${seg("kept")} ${prime} .msc-ring-label { fill: var(--tan); }`,
        `${seg("sky")} ${prime} :is(.msc-ring-cof, .msc-ring-sde, .msc-ring-arrow) ${lit}`,
        `${seg("sky")} .msc-ring-sky-wedge[data-prime="${p}"] ${lit}`,
        // Ring → timeseries.
        `${mark([...keptKinds, "loss", "gross"])} ${layer("kept")} { outline: 2px solid var(--tan); outline-offset: -2px; }`,
        `${mark(["cof", "sde", "sky", "share"])} ${layer("sky")} { outline: 2px solid var(--tan); outline-offset: -2px; }`,
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
        <span className="msc-key-item" data-key="cof">{swatch(`var(${SLICE_TOKEN.cof})`)} CoF · cost of funds → Sky</span>
        <span className="msc-key-item" data-key="sde">{swatch(`var(${SLICE_TOKEN.sde})`)} SDE · Sky Direct Exposure → Sky</span>
        <span className="msc-key-item" data-key="kept">{swatch(`var(${SLICE_TOKEN.kept})`)} kept · supply kept</span>
        <span className="msc-key-item" data-key="neg">
          {swatch(
            "repeating-linear-gradient(45deg, var(--msc-kept) 0, var(--msc-kept) 2px, transparent 2px, transparent 4px)",
          )}
          supply loss (the hole)
        </span>
        {DEMAND_SERIES.map((s) => (
          <span key={s.key} className="msc-key-item" data-key={s.key}>
            {swatch(`var(${SLICE_TOKEN[s.key]})`)} {SLICE_CODE[s.key]} · {s.label.toLowerCase()} (demand-side)
          </span>
        ))}
      </p>
      <p className="text-center mt-1">
        Each Prime is a pie of its gross revenue* line items; Sky is a pie of
        the To-Sky total by Prime — all on one area scale. A loss is a hole in
        the middle of its pie (the ring's area is gross revenue). The To-Sky
        slices face Sky and feed the arrow. Hover for figures; click a Prime
        to open its settlement page.
      </p>
      <p className="text-center mt-1 italic">
        *Gross revenue = prime agent revenue + demand-side + Sky Direct
        Exposure, before cost of funds (equally: To Sky + supply kept +
        demand-side).
      </p>
    </div>
  );
}
