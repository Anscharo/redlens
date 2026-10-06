import { formatUsd } from "../../lib/settlements";
import type { StreamModel } from "@/lib/settlementStreams";
import { CX, CY, PRIME_HALF, SKY_HALF, type ArcLayout, type Span } from "../../lib/settlementArcLayout";

/** A node piece across the radii of `s`: vertical at the Prime (apex),
 *  horizontal at Sky (right). */
function Piece({ s, at, className, title }: { s: Span; at: "prime" | "sky"; className: string; title: string }) {
  const len = s.r1 - s.r0;
  const box = at === "prime"
    ? { x: CX - PRIME_HALF, y: CY - s.r1, width: PRIME_HALF * 2, height: len }
    : { x: CX + s.r0, y: CY - SKY_HALF, width: len, height: SKY_HALF * 2 };
  return (
    <rect {...box} rx={2} className={className}>
      <title>{title}</title>
    </rect>
  );
}

/** The Prime node: its length is what reaches it — the pool of venue
 *  revenue (or the cost of funds, when larger) and the demand side from
 *  Sky — with SDE passing through the gap between. The pool's outer part,
 *  which no band leaves, is what the Prime keeps, filled in; a shortfall
 *  there is striped. */
export function PrimeNode({ node, model, primeLabel }: { node: ArcLayout["prime"]; model: StreamModel; primeLabel: string }) {
  const { pool, kept, demand } = node;
  return (
    <g>
      {pool && <Piece s={pool} at="prime" className="msc-arc-node" title={`${primeLabel}: ${formatUsd(model.revenue)} venue revenue in, ${formatUsd(model.cof)} cost of funds out to Sky`} />}
      {kept && (
        <Piece
          s={kept}
          at="prime"
          className={kept.loss ? "msc-arc-node-loss" : "msc-arc-node-kept"}
          title={kept.loss ? `Cost of funds exceeded venue revenue by ${formatUsd(-model.kept)}; ${primeLabel} covers the difference` : `${primeLabel} keeps ${formatUsd(model.kept)}: venue revenue less cost of funds`}
        />
      )}
      {demand && <Piece s={demand} at="prime" className="msc-arc-node" title={`${primeLabel}: ${formatUsd(model.demandTotal)} demand-side from Sky`} />}
    </g>
  );
}

/** Sky's node: what arrives (cost of funds + SDE) and, apart, what leaves
 *  (the demand side), each as long as its amount — never one netted bar. */
export function SkyNode({ node, model, primeLabel }: { node: ArcLayout["sky"]; model: StreamModel; primeLabel: string }) {
  return (
    <g>
      {node.toSky && <Piece s={node.toSky} at="sky" className="msc-arc-sky" title={`Sky receives ${formatUsd(model.toSky)} from ${primeLabel}`} />}
      {node.fromSky && <Piece s={node.fromSky} at="sky" className="msc-arc-node" title={`Sky pays ${primeLabel} ${formatUsd(model.demandTotal)}`} />}
    </g>
  );
}
