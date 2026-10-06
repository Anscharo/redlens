import { useMemo } from "react";
import type { StreamModel } from "@/lib/settlementStreams";
import { SETTLEMENT_CITATIONS } from "@/lib/settlementCitations";
import { atlasHref } from "@/lib/routes";
import { layoutSettlementRing } from "../../lib/settlementRingLayout";
import { AtlasLink } from "../AtlasLink";
import { SettlementRingSvg } from "./SettlementRingSvg";
import { SettlementVenueTable } from "./SettlementVenueTable";

/** A Prime's month as two lanes around it: clockwise, what it owes Sky;
 *  counterclockwise, what Sky owes it — every figure linked to the Atlas
 *  document that defines it, with the venue table under it, which splits
 *  the outer lane row by row and totals to the headline card. */
export function SettlementRing({ model, primeLabel, month }: { model: StreamModel; primeLabel: string; month?: string }) {
  const layout = useMemo(() => layoutSettlementRing(model), [model]);
  const { toSky, fromSky, execVote } = SETTLEMENT_CITATIONS;
  return (
    <figure className="msc-ring-frame m-0" aria-label={`Settlement flows between ${primeLabel} and Sky`}>
      <SettlementRingSvg layout={layout} model={model} primeLabel={primeLabel} month={month} />
      <figcaption className="mono text-[10px] mt-1" style={{ color: "var(--tan-3)" }}>
        Clockwise, outer: the <AtlasLink to={atlasHref(toSky.uuid)} className="msc-ring-caption-link">amount due from {primeLabel} to Sky</AtlasLink>.
        Counterclockwise, inner: the <AtlasLink to={atlasHref(fromSky.uuid)} className="msc-ring-caption-link">amount due from Sky to {primeLabel}</AtlasLink>.
        Both are paid in the <AtlasLink to={atlasHref(execVote.uuid)} className="msc-ring-caption-link">Sky Core Executive Vote</AtlasLink> as two amounts, never netted.
        Muted figures are Soter Labs workbook figures the Atlas defines no term for; striped is a loss.
      </figcaption>
      <SettlementVenueTable model={model} primeLabel={primeLabel} />
    </figure>
  );
}
