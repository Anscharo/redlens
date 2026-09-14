import { useUrlState, urlString } from "../../hooks/useUrlState";
import {
  hasMultiVenuePnl,
  hasVenueAum,
  isDemandSideCycle,
  type SettlementReport,
} from "../../lib/settlements";
import { Tooltip } from "../Tooltip";
import { useTweened } from "../../hooks/useTweened";
import { tweenVenues } from "../../lib/mscTween";
import { SettlementVenuePnl } from "./SettlementSankey";
import { SettlementAum } from "./SettlementAum";

const venuesCodec = urlString(null);

export function ActorSettlementVenues({
  report,
  name,
}: {
  report: SettlementReport;
  name: string;
}) {
  // A month change is drawn as a transition: the rows tween (mscTween.ts)
  // and the Sankey and AUM bars lay out from them every frame.
  const venues = useTweened(report.venues, tweenVenues);
  const multi = hasMultiVenuePnl(report);
  const aum = hasVenueAum(report);
  // ?venues=aum; PnL is the default and needs no param.
  const [venuesParam, setVenuesParam] = useUrlState("venues", venuesCodec);
  const view: "pnl" | "aum" = venuesParam === "aum" ? "aum" : "pnl";
  const setView = (v: "pnl" | "aum") => setVenuesParam(v === "aum" ? "aum" : null);
  const toggle = multi && aum;
  const showPnl = multi && (!toggle || view === "pnl");
  const showAum = aum && (!multi || view === "aum");

  if (!showPnl && !showAum) {
    return (
      <p className="text-sm italic" style={{ color: "var(--tan-3)" }}>
        Published workbooks list no venue-level PnL for {name}.
        {isDemandSideCycle(report)
          ? " Demand-side figures are agent rate and rewards; Sky's take is zero."
          : ""}
      </p>
    );
  }

  return (
    <>
      {toggle && (
        <div role="group" aria-label="Venue view" className="flex gap-2 mb-3">
          <Tooltip content="Profit & Loss">
            <button
              type="button"
              className="scope-pill mono text-[10px] uppercase tracking-wider px-2 py-1"
              data-active={view === "pnl" ? "true" : undefined}
              aria-pressed={view === "pnl"}
              aria-label="Profit & Loss"
              onClick={() => setView("pnl")}
            >
              PnL
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
      {showPnl && (
        <SettlementVenuePnl venues={venues} primeLabel={name} month={report.month} />
      )}
      {showAum && <SettlementAum venues={venues} />}
    </>
  );
}
