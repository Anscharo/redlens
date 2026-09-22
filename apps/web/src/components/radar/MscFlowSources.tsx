import { formatUsd } from "../../lib/settlements";
import { GROUP_HEADING, GROUP_HEADING_SIZE, LABEL_X, NODE_W, SOURCE_LABEL, type FlowSource } from "../../lib/mscFlowLayout";

/** The left-hand line items: one bar per source, its name and amount flush
 *  left, and — on the first Sky-owed row — the heading over the bracketed
 *  group. Each bar sits its own label-length in from the edge, so the
 *  column is a stagger (mscFlowLayout's `sourceBarX`). */
export function FlowSources({ sources, owed }: { sources: FlowSource[]; owed: number }) {
  return (
    <>
      {sources.map((s) => (
        <g key={s.kind} className="msc-flow-source" data-kind={s.kind} data-origin={s.origin} style={{ opacity: s.alpha }}>
          {/* The heading sits ABOVE the bracketed rows, flush left with every
              other label rather than beside the bracket: the bracket's column
              is 18 units wide and would need the text turned on its side. It
              carries the group total whether or not a bracket was drawn. The
              earned group has no heading at all — its items name themselves. */}
          {s.headingY != null && (
            <text x={LABEL_X} y={s.headingY} textAnchor="start" fontSize={GROUP_HEADING_SIZE} className="msc-flow-group-heading mono">
              {GROUP_HEADING.sky}
              {` | ${formatUsd(owed, true)}`}
            </text>
          )}
          <rect x={s.x} y={s.y} width={NODE_W} height={s.h} className={`msc-ring-${s.kind}`} />
          <text x={s.labelX} y={s.labelY + 15} textAnchor="start" fontSize={44} className="msc-ring-label">
            {SOURCE_LABEL[s.kind]}
            <tspan className="msc-ring-sublabel mono"> | {formatUsd(s.value, true)}</tspan>
          </text>
        </g>
      ))}
    </>
  );
}
