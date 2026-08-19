import { useState } from "react";
import {
  hasMultiVenuePnl,
  hasVenueAum,
  isDemandSideCycle,
  type SettlementReport,
} from "../../lib/settlements";
import { Tooltip } from "../Tooltip";
import { SettlementVenuePnl } from "./SettlementSankey";
import { SettlementAum } from "./SettlementAum";

export function ActorSettlementVenues({ report, name }: { report: SettlementReport; name: string }) {
  const multi = hasMultiVenuePnl(report);
  const aum = hasVenueAum(report);
  const [view, setView] = useState<"pnl" | "aum">("pnl");
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
              onClick={() => setView("aum")}
            >
              AUM
            </button>
          </Tooltip>
        </div>
      )}
      {showPnl && <SettlementVenuePnl venues={report.venues} primeLabel={name} />}
      {showAum && <SettlementAum venues={report.venues} />}
    </>
  );
}
