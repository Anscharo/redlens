import type { ReactNode } from "react";
import { DASH_LINE, GAP, LINE1_H, NODE_D, PAD_Y, RAIL_W, TimelineRow } from "./Timeline";

/** How far right of the content edge a branch's dot sits. */
const DOT_X = 10;
/** Where a branch's lines start: past its dot by the usual gutter gap. */
const BRANCH_INDENT = DOT_X + NODE_D / 2 + GAP;
const DOT_TOP = PAD_Y + LINE1_H / 2;
/** The rail's centre, measured from the content edge. */
const RAIL_X = -(RAIL_W / 2 + GAP);
const SPUR = "repeating-linear-gradient(to right, var(--preview-add) 0 3px, transparent 3px 7px)";
/** The section's line fades in and out over this, like the overall entry's. */
const FADE = "linear-gradient(to bottom, transparent, black 28px, black calc(100% - 28px), transparent)";

/** A preview branch's own history under its overall entry: one dashed line on
 *  the rail, faded in at the top and out at the bottom. Its rows draw no line
 *  of their own (TimelineRow hideTop, TimelineBranch). */
export function TimelineDashedSection({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      <span aria-hidden="true" className="absolute" data-timeline-section style={{ ...DASH_LINE, top: 0, bottom: 0, WebkitMaskImage: FADE, maskImage: FADE }} />
      {children}
    </div>
  );
}

/** A commit branched off the section's line: a dashed spur leaves the line for
 *  the commit's dot, and the commit's lines sit indented past that dot.
 *  Without a dot it is an indented row with no spur. */
export function TimelineBranch({ dot, children }: { dot?: string; children: ReactNode }) {
  const pad = dot ? PAD_Y : 0;
  return (
    <TimelineRow hideTop>
      <div className="relative" style={{ paddingLeft: BRANCH_INDENT, paddingTop: pad, paddingBottom: pad }}>
        {dot && (
          <span aria-hidden="true">
            <span className="absolute" data-timeline-spur style={{ left: RAIL_X, width: DOT_X - RAIL_X, top: DOT_TOP - 1, height: 2, backgroundImage: SPUR }} />
            <span
              className="absolute rounded-full"
              data-timeline-dot
              style={{ left: DOT_X, top: DOT_TOP, width: NODE_D, height: NODE_D, transform: "translate(-50%, -50%)", background: dot, border: "2px solid var(--bg)" }}
            />
          </span>
        )}
        {children}
      </div>
    </TimelineRow>
  );
}
