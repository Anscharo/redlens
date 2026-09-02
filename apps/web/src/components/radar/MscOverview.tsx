import { useMemo, useRef } from "react";
import { useLoaded } from "../../hooks/useAtlasData";
import { useUrlState, urlString } from "../../hooks/useUrlState";
import {
  loadSettlements,
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
import { MscTimeseries } from "./MscTimeseries";

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
        return { flow, ring, label: labelOf(flow.prime), to };
      }),
    [layout, flows, actors, month, labelOf],
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
    <section className="px-6 pt-6">
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
      <div className="flex flex-wrap items-start gap-x-10 gap-y-4 min-w-0">
        <MscTimeseries
          primes={stack.primes}
          months={stack.months}
          primeLabel={labelOf}
          selected={month}
          onSelect={(m) => setMsc(m === latest ? null : m)}
        />
        <div className="flex-1 min-w-0" style={{ flexBasis: 340, maxWidth: "100%" }}>
          <MscRing
            layout={layout}
            primes={ringPrimes}
            month={month}
            centerFigure={formatUsd(eco.sky, true)}
          />
          <RingKey />
        </div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-sm">
        {ecosystemHeadlineFigures(eco).map((f) => (
          <SettlementFigure key={f.label} {...f} />
        ))}
      </div>
    </section>
  );
}

function RingKey() {
  const swatch = (token: string) => (
    <span className="inline-block w-2 h-2 mr-1 align-middle" style={{ background: `var(${token})` }} />
  );
  return (
    <div className="mono text-[10px] mt-5" style={{ color: "var(--tan-3)" }}>
      <p className="flex flex-wrap gap-x-4 gap-y-1 justify-center">
        <span>{swatch("--msc-sky")} to Sky — flows inward to the Sky disc</span>
        <span>{swatch("--msc-kept")} supply kept — points outward</span>
        <span>{swatch("--msc-demand")} demand-side — points outward</span>
        <span>striped, drawn into the band = negative</span>
      </p>
      <p className="text-center mt-1">
        Each ring segment is one Prime for the selected month — click it to open that
        Prime's settlement page.
      </p>
    </div>
  );
}
