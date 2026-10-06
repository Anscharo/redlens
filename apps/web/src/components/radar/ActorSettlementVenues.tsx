import { useMemo } from "react";
import { useUrlState, urlString } from "../../hooks/useUrlState";
import { collapseAum, hasVenueAum, type SettlementReport } from "../../lib/settlements";
import { hasStreams, streamModel } from "@/lib/settlementStreams";
import { Tooltip } from "../Tooltip";
import { useTweened } from "../../hooks/useTweened";
import { tweenStreamModel, tweenVenues } from "../../lib/mscTween";
import { SettlementArc } from "./SettlementArc";
import { SettlementAum } from "./SettlementAum";
import { arcSources } from "../../lib/settlementArcRows";
import { venueInks } from "../../lib/venueInks";

const venuesCodec = urlString(null);
/** A month change on the venue charts, slower than the overview's: a
 *  dozen streams re-threading at once needs the time to be seen. */
export const SETTLE_TWEEN_MS = 1500;

export function ActorSettlementVenues({
  report,
  name,
}: {
  report: SettlementReport;
  name: string;
}) {
  // A month change is drawn as a transition: the inputs tween (mscTween.ts)
  // and the arc and AUM bars lay out from them every frame.
  const target = useMemo(() => streamModel(report), [report]);
  const model = useTweened(target, tweenStreamModel, SETTLE_TWEEN_MS);
  const venues = useTweened(report.venues, tweenVenues, SETTLE_TWEEN_MS);
  // One colour per venue across both views, from the month being shown.
  const inks = useMemo(() => {
    const arc = arcSources(target);
    return venueInks([...arc.revenue, ...arc.sde].map((v) => v.venue), collapseAum(report.venues).map((v) => v.id));
  }, [target, report.venues]);
  const flows = hasStreams(target);
  const aum = hasVenueAum(report);
  // ?venues=aum; the flows are the default and need no param.
  const [venuesParam, setVenuesParam] = useUrlState("venues", venuesCodec);
  const view: "pnl" | "aum" = venuesParam === "aum" ? "aum" : "pnl";
  const setView = (v: "pnl" | "aum") => setVenuesParam(v === "aum" ? "aum" : null);
  const toggle = flows && aum;
  const showFlows = flows && (!toggle || view === "pnl");
  const showAum = aum && (!flows || view === "aum");

  if (!showFlows && !showAum) {
    return (
      <p className="text-sm italic" style={{ color: "var(--tan-3)" }}>
        Nothing settled between {name} and Sky this month.
      </p>
    );
  }

  return (
    <>
      {toggle && (
        <div role="group" aria-label="Venue view" className="flex gap-2 mb-3">
          <Tooltip content="Who paid whom this month">
            <button
              type="button"
              className="scope-pill mono text-[10px] uppercase tracking-wider px-2 py-1"
              data-active={view === "pnl" ? "true" : undefined}
              aria-pressed={view === "pnl"}
              aria-label="Settlement flows"
              onClick={() => setView("pnl")}
            >
              Flows
            </button>
          </Tooltip>
          <Tooltip content="Assets Under Management">
            <button
              type="button"
              className="scope-pill mono text-[10px] uppercase tracking-wider px-2 py-1"
              data-active={view === "aum" ? "true" : undefined}
              aria-pressed={view === "aum"}
              aria-label="Assets Under Management"
              onClick={() => setView("aum")}
            >
              AUM
            </button>
          </Tooltip>
        </div>
      )}
      {showFlows && <SettlementArc model={model} primeLabel={name} month={report.month} inks={inks} />}
      {showAum && <SettlementAum venues={venues} inks={inks} />}
    </>
  );
}
