import { useMemo } from "react";
import { collapseVenues, layoutVenueSankey, type SankeyVenue } from "../../lib/settlementSankey";
import { SettlementSankeyView } from "./SettlementSankeyView";
import { SettlementVenueTable } from "./SettlementVenueTable";

/** Static CSS can't match "same data-venue as the hovered element" — emit one rule per id. */
function VenueHoverStyles({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  const rules = ids.map((id) => {
    const s = CSS.escape(id);
    return `
.msc-venue-pnl:has([data-venue="${s}"]:hover) [data-venue="${s}"] { opacity: 0.92; }
.msc-venue-pnl:has([data-venue="${s}"]:hover) tr[data-venue="${s}"] {
  opacity: 1;
  background: var(--row-hover);
}
.msc-venue-pnl:has([data-venue="${s}"]:hover) tr[data-venue="${s}"] td:first-child span:first-child {
  color: var(--tan);
}
.msc-venue-pnl:has([data-venue="${s}"]:hover) .msc-sankey-venue[data-venue="${s}"] .msc-sankey-node-label {
  fill: var(--tan);
}`;
  }).join("");
  return <style>{rules}</style>;
}

export function SettlementVenuePnl({
  venues,
  primeLabel,
}: {
  venues: SankeyVenue[];
  primeLabel: string;
}) {
  const rows = useMemo(() => collapseVenues(venues), [venues]);
  const layout = useMemo(() => layoutVenueSankey(rows, primeLabel), [rows, primeLabel]);
  const venueIds = useMemo(() => rows.map((v) => v.id), [rows]);

  if (layout.nodes.length === 0) return null;

  return (
    <div className="msc-venue-pnl">
      <VenueHoverStyles ids={venueIds} />
      <SettlementSankeyView rows={rows} layout={layout} primeLabel={primeLabel} />
      <SettlementVenueTable rows={rows} primeLabel={primeLabel} />
    </div>
  );
}
