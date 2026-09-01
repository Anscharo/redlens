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
  ecosystemMonths,
  ecosystemThreeWay,
  primeFlowsForMonth,
  settlementMonths,
  type OverviewActor,
} from "@/lib/settlementsOverview";
import { settlementsHref } from "@/lib/routes";
import { layoutMscRing } from "../../lib/mscOverviewLayout";
import { track } from "../../lib/analytics";
import { SettlementBars } from "./SettlementBars";
import { SettlementFigure } from "./SettlementFigures";
import { MscRing, type MscRingPrime } from "./MscRing";

const mscCodec = urlString(null);
const SOURCE = "https://github.com/soterlabs/settlement-reports";

export function MscOverview({ actors }: { actors: OverviewActor[] }) {
  const bundle = useLoaded(loadSettlements, { soft: true });
  const months = useMemo(() => (bundle ? settlementMonths(bundle) : []), [bundle]);
  const latest = months[months.length - 1] ?? null;
  const [msc, setMsc] = useUrlState("msc", mscCodec);
  const month = months.includes(msc ?? "") ? msc! : latest;

  const flows = useMemo(
    () => (bundle && month ? primeFlowsForMonth(bundle, month) : []),
    [bundle, month],
  );
  const layout = useMemo(() => layoutMscRing(flows), [flows]);
  const ringPrimes = useMemo<MscRingPrime[]>(
    () =>
      layout.primes.map((ring) => {
        const flow = flows.find((f) => f.prime === ring.prime)!;
        const actor = actorForPrimeKey(flow.prime, actors);
        const to = actor
          ? settlementsHref(actor.slug) + (month !== flow.latestMonth ? `?msc=${month}` : "")
          : null;
        const label = actor?.name ?? flow.prime.charAt(0).toUpperCase() + flow.prime.slice(1);
        return { flow, ring, label, to };
      }),
    [layout, flows, actors, month],
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
        (A.2.3.1.2.1.1). Click a Prime to open its settlement page.{" "}
        <a href={SOURCE} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
          Source workbooks
        </a>
      </p>
      <SettlementBars
        title="Ecosystem by month"
        months={ecosystemMonths(bundle)}
        selected={month}
        onSelect={(m) => setMsc(m === latest ? null : m)}
      />
      <MscRing
        layout={layout}
        primes={ringPrimes}
        month={month}
        centerFigure={formatUsd(eco.sky, true)}
      />
      <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-sm">
        {ecosystemHeadlineFigures(eco).map((f) => (
          <SettlementFigure key={f.label} {...f} />
        ))}
      </div>
    </section>
  );
}
