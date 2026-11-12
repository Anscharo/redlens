import { PLUMBING_KEY, type Plumbing, type PlumbingKind, type PlumbingLane } from "@/lib/pauPlumbing";
import { PLUMBING_COLOR, PlumbingEdgeLine, PlumbingNodeBox, plumbingMarker } from "./PauPlumbingParts";

export const PLUMBING_EDGE_KINDS = Object.keys(PLUMBING_KEY) as PlumbingKind[];

const caps = { textTransform: "uppercase" } as const;

/** A lane's name in the gutter left of its row. */
function PlumbingLaneLabel({ lane }: { lane: PlumbingLane }) {
  return (
    <g data-lane={lane.title}>
      <text x={20} y={lane.y + 34} fontSize={11} fontWeight={600} letterSpacing="0.06em" style={{ ...caps, fill: "var(--tan)" }}>{lane.title}</text>
      <text x={20} y={lane.y + 50} fontSize={10} style={{ fill: "var(--tan-3)" }}>{lane.sub}</text>
    </g>
  );
}

/** One drawing: the PAU framed, the parts around it, and an arrow per access rule. */
export function PlumbingSvg({ plumbing }: { plumbing: Plumbing }) {
  const f = plumbing.frame;
  const titleId = `${plumbing.id}-title`;
  return (
    <svg viewBox={`0 0 ${plumbing.w} ${plumbing.h}`} role="img" aria-labelledby={titleId} className="block w-full" style={{ minWidth: 720, maxWidth: plumbing.w }}>
      <title id={titleId}>{plumbing.summary}</title>
      <defs>
        {PLUMBING_EDGE_KINDS.map((k) => (
          <marker key={k} id={plumbingMarker(plumbing.id, k)} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" style={{ fill: PLUMBING_COLOR[k] }} />
          </marker>
        ))}
      </defs>
      <rect x={f.x} y={f.y} width={f.w} height={f.h} rx={10} fill="none" strokeDasharray="3 4" style={{ stroke: "var(--tan-3)" }} />
      <text x={f.x + 12} y={f.y + 18} fontSize={10} letterSpacing="0.06em" style={{ ...caps, fill: "var(--tan-3)" }}>{plumbing.frameLabel}</text>
      {plumbing.lanes?.map((l) => <PlumbingLaneLabel key={l.y} lane={l} />)}
      {plumbing.edges.map((e) => <PlumbingEdgeLine key={`${e.from}-${e.to}`} edge={e} scope={plumbing.id} />)}
      {plumbing.nodes.map((n) => <PlumbingNodeBox key={n.id} node={n} />)}
    </svg>
  );
}
