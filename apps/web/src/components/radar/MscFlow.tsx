import { formatMonth, formatUsd } from "../../lib/settlements";
import {
  AGENT_W, GROUP_HEADING, GROUP_HEADING_SIZE, HEADERS, HEADER_SIZE, HEADER_Y,
  LABEL_X, MID_X, NODE_W, SKY_LABEL_X, SOURCE_LABEL, type FlowLayout,
} from "../../lib/mscFlowLayout";
import { RingHoverStyles } from "./MscRingHoverStyles";
import { markId } from "./MscRingPills";
import { FlowAgentGroup } from "./MscFlowAgent";
import { FlowPills } from "./MscFlowPills";
import { MscFlowZoomReset } from "./MscFlowZoomReset";
import type { OverviewPrime } from "./MscRingPrime";
import { useTweenedFlow } from "../../hooks/useTweenedFlow";
import { useSvgZoom } from "../../hooks/useSvgZoom";

interface Props {
  layout: FlowLayout;
  primes: OverviewPrime[];
  month: string;
  /** Compact ecosystem To-Sky figure, shown beside the Sky bar. */
  centerFigure: string;
}

/** The column headers over the three node groups — pure chrome, so the
 *  overview's loading skeleton draws them on an empty canvas too. Each is
 *  anchored the way its column is: SOURCE flush left with the labels,
 *  PRIME over the middle of its bars, SKY flush right with the To Sky line. */
export function FlowHeaders() {
  return (
    <>
      <text x={LABEL_X} y={HEADER_Y} textAnchor="start" fontSize={HEADER_SIZE} className="msc-flow-header mono">
        {HEADERS.source}
      </text>
      <text x={MID_X + AGENT_W / 2} y={HEADER_Y} textAnchor="middle" fontSize={HEADER_SIZE} className="msc-flow-header mono">
        {HEADERS.prime}
      </text>
      <text x={SKY_LABEL_X} y={HEADER_Y} textAnchor="end" fontSize={HEADER_SIZE} className="msc-flow-header mono">
        {HEADERS.sky}
      </text>
    </>
  );
}

/** The three-stage flow chart: sources → Primes → Sky. Speaks the orbital
 *  chart's mark vocabulary (.msc-ring-prime / .msc-ring-mark / data-mark /
 *  .msc-ring-<kind> / .msc-ring-sky-wedge), so the key, the cross-chart
 *  hover and the pills work on it unchanged. A month change is drawn as a
 *  transition (useTweenedFlow): bars stretch and slide, ribbons re-thread,
 *  a Prime that joins or leaves grows in or peels away. The wheel zooms the
 *  viewBox about the pointer (useSvgZoom) so the hairline ribbons can be
 *  hovered; the zoom is on the view, not the data, so it survives a month
 *  change and the tween never sees it. */
export function MscFlow({ layout: target, primes, month, centerFigure }: Props) {
  const layout = useTweenedFlow(target);
  const zoom = useSvgZoom(layout.width, layout.height);
  const meta = new Map(primes.map((p) => [p.flow.prime, p]));
  const labelOf = (prime: string) => meta.get(prime)?.label ?? prime;
  // Hover rules come from the month being shown, not the frame in flight.
  const marks = target.agents.map((a) => ({
    prime: a.prime,
    kinds: [...a.inbound.map((l) => l.kind as string), "gross", ...(a.outbound.length ? ["sky", "share"] : [])],
  }));
  const { sky } = layout;
  // touch-action is only surrendered once zoomed, so a finger drag over the
  // chart still scrolls the page on a phone at rest.
  return (
    <>
      <RingHoverStyles marks={marks} />
      <figure className="msc-ring-frame msc-flow-frame" style={{ position: "relative" }} aria-label={`Monthly Settlement Cycle flows for ${formatMonth(month)}`}>
        <svg
          ref={zoom.ref}
          className="msc-ring msc-flow"
          viewBox={zoom.viewBox}
          preserveAspectRatio="xMidYMid meet"
          data-zoomed={zoom.zoomed ? "true" : undefined}
          style={{ cursor: zoom.zoomed ? "grab" : undefined, touchAction: zoom.zoomed ? "none" : undefined }}
          onDoubleClick={zoom.reset}
          {...zoom.pan}
        >
          <desc>Scroll or pinch over the chart to zoom in on a ribbon, drag to pan, double-click to reset.</desc>
          <FlowHeaders />
          {/* Sky's LEFT node and its ribbons into the demand-side bars: that
              money is owed BY Sky (A.2.4.1.2.2.1.1.1), so it starts here and
              Sky appears at both ends of the chart. Drawn under the source
              bars so the ribbons dock behind them. */}
          {layout.skySource && (
            <g className="msc-flow-sky-source" style={{ opacity: layout.skySource.alpha }}>
              {layout.skySource.links.map((l) => (
                <path key={l.kind} d={l.path} className={`msc-ring-slice msc-ring-${l.kind}`} />
              ))}
              {/* Painted in Sky's own blue, like the bar on the right, so the
                  two ends read as the same party rather than two charts. */}
              {/* No label of its own: the group heading above already reads
                  "OWED BY SKY | <total>". A second "Sky | …" line here sat in
                  the line-item column and read as a fourth source. */}
              <rect
                x={layout.skySource.x}
                y={layout.skySource.y}
                width={NODE_W}
                height={layout.skySource.h}
                className="msc-ring-sky-wedge"
                style={{ fill: "var(--msc-sky)" }}
              />
            </g>
          )}
          {layout.sources.map((s) => (
            <g key={s.kind} className="msc-flow-source" data-kind={s.kind} data-origin={s.origin} style={{ opacity: s.alpha }}>
              {/* The Sky group's heading carries its total, so the Sky node
                  below needs no label of its own. The earned group has no
                  heading at all — its line items name themselves. */}
              {s.headingY != null && (
                <text x={LABEL_X} y={s.headingY} textAnchor="start" fontSize={GROUP_HEADING_SIZE} className="msc-flow-group-heading mono">
                  {GROUP_HEADING.sky}
                  {layout.skySource ? ` | ${formatUsd(layout.skySource.value, true)}` : ""}
                </text>
              )}
              <rect x={s.x} y={s.y} width={NODE_W} height={s.h} className={`msc-ring-${s.kind}`} />
              <text x={s.labelX} y={s.labelY + 15} textAnchor="start" fontSize={44} className="msc-ring-label">
                {SOURCE_LABEL[s.kind]}
                <tspan className="msc-ring-sublabel mono"> | {formatUsd(s.value, true)}</tspan>
              </text>
            </g>
          ))}
          {/* Sky: one bar, split by Prime and by type — the same "To Sky"
              name-then-figure treatment as the orbit's pie, right-aligned
              into the gutter and centred on the bar the way a source label
              is centred on its own. The Primes are not named here again;
              each share's hover pill says whose. */}
          <text x={SKY_LABEL_X} y={sky.y + sky.h / 2 + 18} textAnchor="end" fontSize={54} className="msc-ring-label">
            To Sky
            <tspan className="msc-ring-sublabel mono"> | {centerFigure}</tspan>
          </text>
          {sky.shares.map((sh) => (
            <g key={sh.prime} className="msc-ring-mark" data-mark={markId(sh.prime, "share")} style={{ opacity: sh.alpha }}>
              {sky.segments
                .filter((seg) => seg.prime === sh.prime)
                .map((seg) => (
                  <rect key={seg.kind} x={sky.x} y={seg.y} width={NODE_W} height={seg.h} className="msc-ring-sky-wedge" data-prime={seg.prime} style={{ fill: `var(--msc-${seg.kind === "cof" ? "sky" : "sde"})` }} />
                ))}
            </g>
          ))}
          {layout.agents.map((a) => {
            const m = meta.get(a.prime);
            return m ? <FlowAgentGroup key={a.prime} agent={a} {...m} month={month} /> : null;
          })}
          <FlowPills layout={layout} labelOf={labelOf} />
        </svg>
        {zoom.zoomed && <MscFlowZoomReset onReset={zoom.reset} />}
      </figure>
    </>
  );
}
