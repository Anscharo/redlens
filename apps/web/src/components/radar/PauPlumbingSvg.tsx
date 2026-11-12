import { PLUMBING_FRAME_LABEL, PLUMBING_H, PLUMBING_KEY, type Plumbing, type PlumbingKind } from "@/lib/pauPlumbing";
import { PLUMBING_COLOR, PlumbingEdgeLine, PlumbingNodeBox, plumbingMarker } from "./PauPlumbingParts";

export const PLUMBING_EDGE_KINDS = Object.keys(PLUMBING_KEY) as PlumbingKind[];

/** One generation's drawing: the PAU's contracts framed, the accounts around them, and an arrow per access rule. */
export function PlumbingSvg({ plumbing }: { plumbing: Plumbing }) {
  const f = plumbing.frame;
  return (
    <svg viewBox={`0 0 ${plumbing.w} ${PLUMBING_H}`} role="img" aria-labelledby="pau-plumbing-title" className="block w-full" style={{ minWidth: 720, maxWidth: plumbing.w }}>
      <title id="pau-plumbing-title">{plumbing.summary}</title>
      <defs>
        {PLUMBING_EDGE_KINDS.map((k) => (
          <marker key={k} id={plumbingMarker(k)} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" style={{ fill: PLUMBING_COLOR[k] }} />
          </marker>
        ))}
      </defs>
      <rect x={f.x} y={f.y} width={f.w} height={f.h} rx={10} fill="none" strokeDasharray="3 4" style={{ stroke: "var(--tan-3)" }} />
      <text x={f.x + 12} y={f.y + 18} fontSize={10} letterSpacing="0.06em" style={{ fill: "var(--tan-3)", textTransform: "uppercase" }}>{PLUMBING_FRAME_LABEL}</text>
      {plumbing.edges.map((e) => <PlumbingEdgeLine key={`${e.from}-${e.to}`} edge={e} />)}
      {plumbing.nodes.map((n) => <PlumbingNodeBox key={n.id} node={n} />)}
    </svg>
  );
}
