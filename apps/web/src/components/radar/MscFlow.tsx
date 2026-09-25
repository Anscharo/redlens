import { useId } from "react";
import { formatMonth } from "../../lib/settlements";
import {
  AGENT_W, HEADERS, HEADER_SIZE, HEADER_Y, LABEL_X, MID_X, NODE_W, owedBySky,
  SKY_LABEL_X, sourceBracket, type FlowLayout,
} from "../../lib/mscFlowLayout";
import { RingHoverStyles } from "./MscRingHoverStyles";
import { markId } from "./MscRingPills";
import { FlowAgentGroup } from "./MscFlowAgent";
import { FlowSources } from "./MscFlowSources";
import { FlowPills } from "./MscFlowPills";
import type { OverviewPrime } from "./MscRingPrime";
import { useTweenedFlow } from "../../hooks/useTweenedFlow";
import { pillScale, useSvgZoom, useZoomReport } from "../../hooks/useSvgZoom";

export interface MscFlowProps {
  layout: FlowLayout;
  primes: OverviewPrime[];
  month: string;
  /** Compact ecosystem To-Sky figure, shown beside the Sky bar. */
  centerFigure: string;
  /** Reports the zoom upward so the reset control can sit in the card's
   *  title row instead of floating over the drawing. */
  onZoom?: (state: { zoomed: boolean; reset: () => void } | null) => void;
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
export function MscFlow({ layout: target, primes, month, centerFigure, onZoom }: MscFlowProps) {
  const layout = useTweenedFlow(target);
  const zoom = useSvgZoom(layout.width, layout.height);
  useZoomReport(zoom.zoomed, zoom.reset, onZoom);
  const meta = new Map(primes.map((p) => [p.flow.prime, p]));
  const labelOf = (prime: string) => meta.get(prime)?.label ?? prime;
  // Hover rules come from the month being shown, not the frame in flight.
  const marks = target.agents.map((a) => ({
    prime: a.prime,
    kinds: [...a.inbound.map((l) => l.kind as string), "gross", ...(a.outbound.length ? ["sky", "share"] : [])],
  }));
  const { sky } = layout;
  // Derived from the tweened rows, so the bracket grows and slides with them.
  const bracket = sourceBracket(layout.sources);
  // Stable per instance, so two of these charts on one page never share a
  // clip path (useId's own colons are not safe inside a url(#…) reference).
  const clipId = `msc-flow-clip-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
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
          data-state={zoom.zoomed ? "zoomed" : "default"}
          style={{ cursor: zoom.zoomed ? "grab" : undefined, touchAction: zoom.zoomed ? "none" : undefined }}
          onDoubleClick={zoom.reset}
          {...zoom.pan}
          {...zoom.keys}
        >
          {/* The svg takes focus for its key map, so it needs a name of its
              own — the figure's label names the figure, not this. */}
          <title>{`Monthly Settlement Cycle: Sources, Primes and Sky for ${formatMonth(month)}`}</title>
          <desc>
            Scroll or pinch over the chart to zoom in on a ribbon, drag to pan, double-click
            to reset. From the keyboard: + and − zoom, the arrow keys pan, 0 or Escape resets.
          </desc>
          {/* The drawing is CLIPPED to whatever the zoom is showing, which
              an outer <svg> would normally do for itself — `.msc-ring` sets
              `overflow: visible` so the hover pills can escape the viewBox,
              and that also let a zoomed-in drawing spill across the card.
              The clip rect IS the current view, so it tracks the zoom; the
              pill layer below is deliberately left outside it, so a pill on
              a mark at the edge still reads whole. */}
          <defs>
            <clipPath id={clipId}>
              <rect x={zoom.view.x} y={zoom.view.y} width={zoom.view.w} height={zoom.view.h} />
            </clipPath>
          </defs>
          <g className="msc-flow-content" clipPath={`url(#${clipId})`}>
            <FlowHeaders />
            {/* The Sky BRACKET: a `[` down the far left gathering the
                demand-side rows, in the same blue as Sky's bar on the right.
                That money is owed BY Sky (A.2.4.1.2.2.1.1.1), so Sky is at
                both ends of the chart — drawn as a bracket rather than a
                node-and-ribbons because those ribbons read as a fourth stage
                of the flow. It carries no label of its own: the heading above
                reads "OWED BY SKY | <total>". Absent when the month has fewer
                than two Sky-owed rows — one row is not a group. */}
            {bracket && (
              <path
                d={bracket.path}
                className="msc-flow-sky-bracket"
                style={{ fill: "none", stroke: "var(--msc-sky)", strokeWidth: 5, strokeLinecap: "round", strokeLinejoin: "round" }}
              />
            )}
            <FlowSources sources={layout.sources} owed={owedBySky(layout.sources)} />
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
          </g>
          <FlowPills layout={layout} labelOf={labelOf} damp={pillScale(zoom.base, zoom.view)} />
        </svg>
      </figure>
    </>
  );
}
