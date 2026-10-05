import { useMemo } from "react";
import type { StreamModel } from "@/lib/settlementStreams";
import { layoutStreams } from "../../lib/streamLayout";
import { SettlementStreamsSvg, inkOf } from "./SettlementStreamsSvg";
import { SettlementVenueTable } from "./SettlementVenueTable";

/**
 * Static CSS can't match "same data-venue as the hovered element" — emit one
 * rule per id. Hovering a venue's name, stream or table row raises all three.
 */
function VenueHoverStyles({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  const rules = ids.map((id) => {
    const s = CSS.escape(id);
    return `
.msc-streams-frame:has([data-venue="${s}"]:hover) .msc-stream[data-venue="${s}"] { opacity: 1; }
.msc-streams-frame:has([data-venue="${s}"]:hover) tr[data-venue="${s}"] { background: var(--row-hover); }
.msc-streams-frame:has([data-venue="${s}"]:hover) .msc-stream-row[data-venue="${s}"] text { fill: var(--tan); }`;
  }).join("");
  return <style>{rules}</style>;
}

function Swatch({ background }: { background: string }) {
  return <span className="inline-block w-2 h-2 mr-1 align-middle" style={{ background }} aria-hidden="true" />;
}

/** A Prime's month as directed streams: where its revenue is earned, what
 *  goes to Sky and what stays, Sky Direct Exposure passing through, and the
 *  demand side coming back from Sky — with the venue table under it, which
 *  carries the same split row by row and totals to the headline card. */
export function SettlementStreams({ model, primeLabel, month }: { model: StreamModel; primeLabel: string; month?: string }) {
  const layout = useMemo(() => layoutStreams(model), [model]);
  const ids = useMemo(() => model.venues.map((v) => v.id), [model.venues]);
  return (
    <figure className="msc-streams-frame m-0" aria-label={`Settlement flows between ${primeLabel} and Sky`}>
      <VenueHoverStyles ids={ids} />
      <figcaption className="mono text-[10px] flex flex-wrap gap-x-4 gap-y-1 mb-2" style={{ color: "var(--tan-3)" }}>
        <span><Swatch background="var(--tan-3)" /> earned at the venue</span>
        <span><Swatch background={inkOf("cof")} /> cost of funds → Sky</span>
        <span><Swatch background={inkOf("sde")} /> Sky Direct Exposure → Sky, passing through</span>
        <span><Swatch background={inkOf("kept")} /> stays with {primeLabel}</span>
        <span><Swatch background="var(--msc-demand)" /> demand side, Sky → {primeLabel}</span>
        <span>
          <Swatch background="repeating-linear-gradient(45deg, var(--msc-loss) 0, var(--msc-loss) 2px, transparent 2px, transparent 4px)" />
          striped · a loss, arrow reversed
        </span>
      </figcaption>
      <SettlementStreamsSvg layout={layout} model={model} primeLabel={primeLabel} month={month} />
      <p className="mono text-[10px] mt-1" style={{ color: "var(--tan-3)" }}>
        Two settlement amounts, never netted: due from {primeLabel} to Sky (A.2.4.1.2.2.1.1.2) and due from Sky to {primeLabel} (A.2.4.1.2.2.1.1.1).
      </p>
      <SettlementVenueTable model={model} primeLabel={primeLabel} />
    </figure>
  );
}
