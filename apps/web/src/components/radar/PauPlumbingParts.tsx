import { PLUMBING_NODE_H, type PlumbingEdge, type PlumbingKind, type PlumbingNode } from "@/lib/pauPlumbing";

/** The colour each kind of edge is drawn in. */
export const PLUMBING_COLOR: Record<PlumbingKind, string> = { flow: "var(--tan-2)", rule: "var(--accent)", stop: "var(--error-text)" };

export const plumbingMarker = (kind: PlumbingKind) => `pau-plumbing-arrow-${kind}`;

/** One part of the PAU: its name, its part in a factory, and what it does. */
export function PlumbingNodeBox({ node }: { node: PlumbingNode }) {
  const tx = node.x + 10;
  return (
    <g data-node={node.id} data-own={node.own || undefined}>
      <rect x={node.x} y={node.y} width={node.w} height={PLUMBING_NODE_H} rx={6} style={{ fill: "var(--surface)", stroke: node.own ? "var(--accent)" : "var(--border)" }} />
      <text x={tx} y={node.y + 16} fontSize={9} letterSpacing="0.06em" style={{ fill: "var(--tan-3)", textTransform: "uppercase" }}>{node.nick}</text>
      <text x={tx} y={node.y + 33} fontSize={13} fontWeight={600} style={{ fill: "var(--tan)" }}>{node.name}</text>
      {node.lines.map((line, i) => (
        <text key={line} x={tx} y={node.y + 50 + i * 13} fontSize={10.5} style={{ fill: "var(--tan-2)" }}>{line}</text>
      ))}
    </g>
  );
}

/** One relationship: an arrow from the part that acts to the part acted on, labelled with what it does. */
export function PlumbingEdgeLine({ edge }: { edge: PlumbingEdge }) {
  const color = PLUMBING_COLOR[edge.kind];
  const marker = `url(#${plumbingMarker(edge.kind)})`;
  return (
    <g data-edge={`${edge.from}-${edge.to}`} data-kind={edge.kind}>
      <title>{edge.rule}</title>
      <path d={edge.d} fill="none" strokeWidth={edge.kind === "flow" ? 2 : 1.5} strokeDasharray={edge.optional ? "5 4" : undefined} markerEnd={marker} markerStart={edge.both ? marker : undefined} style={{ stroke: color }} />
      <text x={edge.lx} y={edge.ly} fontSize={10} textAnchor={edge.align ?? "start"} style={{ fill: color }}>{edge.label}</text>
    </g>
  );
}
