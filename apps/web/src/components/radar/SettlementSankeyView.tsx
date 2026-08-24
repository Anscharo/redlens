import { useMemo } from "react";
import {
  type SankeyLink,
  type SankeyVenue,
  type SankeyLayout,
} from "../../lib/settlementSankey";
import { SankeySinkNode, SankeyVenueNode } from "./SettlementSankeyNodes";

function linkFill(l: SankeyLink): string {
  if (l.signed < 0) return "var(--accent)";
  return l.to === "sky" ? "var(--depth-4)" : "var(--entity-delegate-org)";
}

function SankeyLinkPath({ l }: { l: SankeyLink }) {
  return (
    <path
      className="msc-sankey-link"
      data-venue={l.from}
      d={l.path}
      fill={linkFill(l)}
    />
  );
}

export function SettlementSankeyView({
  rows,
  layout,
  primeLabel,
}: {
  rows: SankeyVenue[];
  layout: SankeyLayout;
  primeLabel: string;
}) {
  const byId = useMemo(() => new Map(rows.map((v) => [v.id, v])), [rows]);
  const skyTotal = useMemo(() => rows.reduce((n, v) => n + v.profitToSky, 0), [rows]);
  const primeTotal = useMemo(() => rows.reduce((n, v) => n + v.profitToGrove, 0), [rows]);

  return (
    <svg
      className="msc-sankey"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-label={`Venue flows to Sky and ${primeLabel}`}
      style={{ color: "var(--tan-2)" }}
    >
      {layout.links.map((l) => (
        <SankeyLinkPath key={`${l.from}-${l.to}`} l={l} />
      ))}
      {layout.nodes.map((n) => {
        if (n.kind === "venue") {
          const v = byId.get(n.id);
          if (!v) return null;
          return <SankeyVenueNode key={n.id} n={n} v={v} primeLabel={primeLabel} />;
        }
        const total = n.id === "sky" ? skyTotal : primeTotal;
        return <SankeySinkNode key={n.id} n={n} total={total} />;
      })}
    </svg>
  );
}
