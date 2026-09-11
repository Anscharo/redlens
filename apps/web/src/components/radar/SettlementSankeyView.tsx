import { useMemo } from "react";
import {
  type SankeyLink,
  type SankeyVenue,
  type SankeyLayout,
} from "../../lib/settlementSankey";
import { ROUTES } from "@/lib/routes";
import { SankeySinkNode, SankeyVenueNode } from "./SettlementSankeyNodes";

/** Ribbons are the series color of what they carry — To Sky blue, supply
 *  kept green — and a NEGATIVE one (a venue that lost money that month,
 *  which comes off the sink's share; nothing is paid to the venue) is the
 *  loss mark: stripes in the loss red, the same mark as everywhere else in
 *  the MSC charts. */
function linkFill(l: SankeyLink): string {
  return l.signed < 0 ? "url(#msc-sankey-loss)" : `var(--msc-${l.to === "sky" ? "sky" : "kept"})`;
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
    <figure
      className="msc-sankey-frame"
      aria-label={`Venue flows to Sky and ${primeLabel}`}
    >
      {/* Legend first. The stripes are the one mark on this chart that isn't
          self-evident: a striped ribbon is a venue's loss, and the striped
          out-bar is those losses coming off the Prime's share. */}
      <figcaption className="mono text-[10px] flex flex-wrap gap-x-4 gap-y-1 mb-2" style={{ color: "var(--tan-3)" }}>
        <span><Swatch background="var(--msc-sky)" /> to Sky</span>
        <span><Swatch background="var(--msc-kept)" /> supply-side kept</span>
        <span><Swatch background={primeColor} /> {primeLabel}</span>
        <span>
          <Swatch background="repeating-linear-gradient(45deg, var(--msc-loss) 0, var(--msc-loss) 2px, transparent 2px, transparent 4px)" />
          striped · venue loss, taken off the Prime's share
        </span>
      </figcaption>
      <svg
        className="msc-sankey"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        style={{ color: "var(--tan-2)" }}
      >
      {/* The loss mark, for the negative ribbons and the sinks' out-bars. */}
      <defs>
        <pattern id="msc-sankey-loss" patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
          <rect width={3} height={6} style={{ fill: "var(--msc-loss)" }} />
        </pattern>
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
            fill={n.flow === "out" ? "url(#msc-sankey-loss)" : series === "sky" ? "var(--msc-sky)" : primeColor}
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
    </figure>
  );
}

function Swatch({ background }: { background: string }) {
  return <span className="inline-block w-2 h-2 mr-1 align-middle" style={{ background }} aria-hidden="true" />;
}
