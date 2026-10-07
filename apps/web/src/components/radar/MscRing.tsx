import { useId } from "react";
import { formatMonth } from "../../lib/settlements";
import type { RingLayout } from "../../lib/mscOverviewLayout";
import { PillOverlay } from "./MscRingPills";
import { RingChart } from "./MscRingChart";
import type { MscRingPrime } from "./MscRingPrime";
import { RingHoverStyles } from "./MscRingHoverStyles";
import { pillScale, useSvgZoom, useZoomReport } from "../../hooks/useSvgZoom";

export type { MscRingPrime } from "./MscRingPrime";

export interface MscRingProps {
  layout: RingLayout;
  primes: MscRingPrime[];
  month: string;
  /** Compact ecosystem To-Sky figure, shown above the Sky pie. */
  centerFigure: string;
  /** Reports the zoom upward so the reset control can sit in the card's
   *  title row instead of floating over the drawing. */
  onZoom?: (state: { zoomed: boolean; reset: () => void } | null) => void;
}

/** How far outside the donut a wedge's pill sits (matches PILL_OFFSET). */
const WEDGE_PILL_GAP = 56;
/** The orbit's pills are drawn at this multiple of their base 16px type —
 *  the canvas renders at about half, so a 1× pill read at ~8px. */
const PILL_SCALE = 1.6;

export function MscRing({ layout, primes, month, centerFigure, onZoom }: MscRingProps) {
  const labelOf = (prime: string) => primes.find((p) => p.flow.prime === prime)?.label ?? prime;
  // The wheel zooms the VIEW, not the data, so it survives a month change
  // and the layout never sees it. The hook works in a 0-based drawing of
  // layout.width × layout.height, while this chart's own frame is a CROP
  // starting at (layout.x, layout.y) — so the drawing is translated into
  // the hook's space rather than the hook being taught about the crop.
  // Unzoomed, "0 0 w h" over a translated drawing is the same picture as
  // the crop was, to the pixel.
  //
  // One difference from the flow chart: that canvas is the same size every
  // month, so its zoom survives a month change. This one's box is cropped
  // to the month's own content, so a month change resizes it and the hook
  // starts over — which is right here, since the old box may not even be
  // inside the new drawing.
  const zoom = useSvgZoom(layout.width, layout.height);
  useZoomReport(zoom.zoomed, zoom.reset, onZoom);
  const [vx, vy, vw, vh] = zoom.viewBox.split(" ").map(Number);
  // useId's own value carries colons; strip them so the `url(#…)` reference
  // is a plain token in every renderer.
  const clipId = `msc-ring-clip${useId().replace(/[^\w-]/g, "")}`;
  // Wedge pills ride just outside the donut on the wedge's own radial, where
  // its arrow docks.
  const midR = (layout.skyR + layout.skyInnerR) / 2;
  const wedgePills = layout.skyWedges.map((w) => ({
    prime: w.prime,
    label: labelOf(w.prime),
    value: w.value,
    toX: layout.cx + midR * Math.cos(w.mid),
    toY: layout.cy + midR * Math.sin(w.mid),
    x: layout.cx + (layout.skyR + WEDGE_PILL_GAP) * Math.cos(w.mid),
    y: layout.cy + (layout.skyR + WEDGE_PILL_GAP) * Math.sin(w.mid),
  }));

  const marks = primes.map((p) => {
    const kinds = [...p.ring.slices.map((s) => s.kind as string), "share", "received"];
    if (p.ring.hole) kinds.push("loss");
    if (p.ring.arrow) kinds.push(p.ring.arrow.kind);
    if (p.ring.demandArrow) kinds.push("demand");
    return { prime: p.flow.prime, kinds };
  });

  return (
    <>
      <RingHoverStyles marks={marks} />
      <figure
        className="msc-ring-frame"
        style={{ position: "relative" }}
        aria-label={`Monthly Settlement Cycle flows for ${formatMonth(month)}`}
      >
        {/* touch-action is only surrendered once zoomed, so a finger drag
            over the chart still scrolls the page on a phone at rest. */}
        <svg
          ref={zoom.ref}
          className="msc-ring"
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
          <title>{`Monthly Settlement Cycle: Sky and each Prime for ${formatMonth(month)}`}</title>
          <desc>
            Scroll or pinch over the chart to zoom in on a slice, drag to pan, double-click
            to reset. From the keyboard: + and − zoom, the arrow keys pan, 0 or Escape resets.
          </desc>
          {/* The loss mark: diagonal stripes in the loss red (a negative
              arrow, the hole) — the same mark every MSC chart uses. */}
          <defs>
            <pattern id="msc-ring-loss" patternUnits="userSpaceOnUse" width={8} height={8} patternTransform="rotate(45)">
              <rect width={4.5} height={8} style={{ fill: "var(--msc-loss)" }} />
            </pattern>
            {/* `.msc-ring` is overflow: visible (the hover pills have to be
                able to leave the frame), which at 1× is invisible and once
                zoomed lets the whole drawing spill over the card. So the
                CHART is clipped to the current view and the PILLS are not —
                the one layer that is supposed to escape. */}
            <clipPath id={clipId}>
              <rect x={vx} y={vy} width={vw} height={vh} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clipId})`}>
            {/* The crop, expressed as a transform so the zoom can work in a
                plain 0-based box. */}
            <g transform={`translate(${-layout.x},${-layout.y})`}>
              <RingChart layout={layout} primes={primes} month={month} centerFigure={centerFigure} labelOf={labelOf} />
            </g>
          </g>
          <g transform={`translate(${-layout.x},${-layout.y})`}>
            <PillOverlay
              rings={primes.map((p) => ({ ring: p.ring, label: p.label }))}
              wedges={wedgePills}
              scale={PILL_SCALE * pillScale(zoom.base, zoom.view)}
            />
          </g>
        </svg>
      </figure>
    </>
  );
}
