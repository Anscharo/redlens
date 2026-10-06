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

/** The Prime node: one bar across every band meeting it — the demand
 *  side received, SDE passing through, the pool of venue revenue (or the
 *  cost of funds, when larger). What the Prime keeps is filled from the
 *  node's middle up; a loss is striped from the middle down. A hairline
 *  marks the middle. */
export function PrimeNode({ node, model, primeLabel }: { node: ArcLayout["prime"]; model: StreamModel; primeLabel: string }) {
  const { span, kept, mid } = node;
  return (
    <g>
      {span && <Piece s={span} at="prime" className="msc-arc-node" title={`${primeLabel}: ${formatUsd(model.revenue)} venue revenue and ${formatUsd(model.demandTotal)} from Sky in; ${formatUsd(model.cof)} cost of funds out to Sky`} />}
      {kept && (
        <Piece
          s={kept}
          at="prime"
          className={kept.loss ? "msc-arc-node-loss" : "msc-arc-node-kept"}
          title={kept.loss ? `Cost of funds exceeded venue revenue by ${formatUsd(-model.kept)}; ${primeLabel} covers the difference` : `${primeLabel} keeps ${formatUsd(model.kept)}: venue revenue less cost of funds`}
        />
      )}
      {mid !== null && <line x1={CX - PRIME_HALF - 3} x2={CX + PRIME_HALF + 3} y1={CY - mid} y2={CY - mid} className="msc-arc-node-mid" />}
    </g>
  );
}

/** Sky's node: one bar across every band meeting it — cost of funds and
 *  SDE arriving, the demand side leaving. Each band keeps its own width,
 *  so the two directions are never netted. */
export function SkyNode({ node, model, primeLabel }: { node: ArcLayout["sky"]; model: StreamModel; primeLabel: string }) {
  if (!node) return null;
  return <Piece s={node} at="sky" className="msc-arc-node" title={`Sky receives ${formatUsd(model.toSky)} from ${primeLabel} and pays it ${formatUsd(model.demandTotal)}`} />;
}
