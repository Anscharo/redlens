import { useMemo } from "react";
import {
  type SankeyLink,
  type SankeyVenue,
  type SankeyLayout,
} from "../../lib/settlementSankey";
import { ROUTES } from "@/lib/routes";
import { SankeySinkNode, SankeyVenueNode } from "./SettlementSankeyNodes";

/** Ribbons are the series color of what they carry — To Sky blue, supply
 *  kept green — and a NEGATIVE one (money going back out to a losing venue)
 *  keeps that color and is striped, the same mark as everywhere else in
 *  the MSC charts, rather than turning a loss hue. */
function linkFill(l: SankeyLink): string {
  const series = l.to === "sky" ? "sky" : "kept";
  return l.signed < 0 ? `url(#msc-sankey-neg-${series})` : `var(--msc-${series})`;
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
  primeColor,
}: {
  rows: SankeyVenue[];
  layout: SankeyLayout;
  primeLabel: string;
  month?: string;
  /** The Prime's identity color: its sink bar (the ribbons into it stay
   *  supply-kept green — that is what they are). */
  primeColor: string;
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
      {/* Diagonal stripes per series, for the negative ribbons and the
          sinks' out-bars. */}
      <defs>
        {(
          [
            ["sky", "var(--msc-sky)"],
            ["kept", "var(--msc-kept)"],
            ["prime", primeColor],
          ] as const
        ).map(([k, color]) => (
          <pattern key={k} id={`msc-sankey-neg-${k}`} patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
            <rect width={3} height={6} style={{ fill: color }} />
          </pattern>
        ))}
      </defs>
      {layout.links.map((l) => (
        <SankeyLinkPath key={`${l.from}-${l.to}`} l={l} />
      ))}
      {layout.nodes.map((n) => {
        if (n.kind === "venue") {
          const v = byId.get(n.id);
          if (!v) return null;
          return <SankeyVenueNode key={n.id} n={n} v={v} primeLabel={primeLabel} />;
        }
        const series = n.kind === "sky" ? "sky" : "prime";
        return (
          <SankeySinkNode
            key={n.id}
            n={n}
            fill={
              n.flow === "out"
                ? `url(#msc-sankey-neg-${series})`
                : series === "sky"
                  ? "var(--msc-sky)"
                  : primeColor
            }
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
