import { useMemo } from "react";
import {
  type SankeyLink,
  type SankeyVenue,
  type SankeyLayout,
} from "../../lib/settlementSankey";
import { ROUTES } from "@/lib/routes";
import { SankeySinkNode, SankeyVenueNode } from "./SettlementSankeyNodes";

function linkFill(l: SankeyLink): string {
  if (l.signed < 0) return "var(--accent)";
  return l.to === "sky" ? "var(--msc-sky)" : "var(--msc-kept)";
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
  month,
}: {
  rows: SankeyVenue[];
  layout: SankeyLayout;
  primeLabel: string;
  month?: string;
}) {
  const byId = useMemo(() => new Map(rows.map((v) => [v.id, v])), [rows]);
  // Gross per direction — each bar is labelled with its own, so a sink's two
  // bars read as "this came in, this went back out" instead of one netted bar.
  const gross = useMemo(() => {
    const sum = (pick: (v: SankeyVenue) => number, sign: number) =>
      rows.reduce((n, v) => n + Math.max(sign * pick(v), 0), 0);
    return {
      sky: sum((v) => v.profitToSky, 1),
      "sky-out": sum((v) => v.profitToSky, -1),
      prime: sum((v) => v.profitToGrove, 1),
      "prime-out": sum((v) => v.profitToGrove, -1),
    } as Record<string, number>;
  }, [rows]);

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
        return (
          <SankeySinkNode
            key={n.id}
            n={n}
            skyTo={month && n.id === "sky" ? `${ROUTES.RADAR}?msc=${month}` : undefined}
            gross={gross[n.id] ?? 0}
            netted={n.flow === "in" && (gross[`${n.id}-out`] ?? 0) > 0}
            net={
              n.flow === "out"
                ? (gross[n.id.replace(/-out$/, "")] ?? 0) - (gross[n.id] ?? 0)
                : undefined
            }
          />
        );
      })}
    </svg>
  );
}
