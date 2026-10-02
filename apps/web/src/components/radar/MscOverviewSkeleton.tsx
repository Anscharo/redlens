import type { ReactNode } from "react";
import { MscHeadline } from "./MscHeadline";
import { MscChartStyle } from "./MscChartStyle";
import { RingKey } from "./MscRingKey";
import { FlowHeaders } from "./MscFlow";
import { HEIGHT, WIDTH } from "../../lib/mscFlowLayout";
import { AXIS_W, COL_W, GAP_PX, TRACK_H } from "./MscTimeseries";

const SOURCE = "https://github.com/soterlabs/settlement-reports";

/** The overview section's chrome — title and intro — shared by the loaded
 *  view and its Suspense fallback so the two render pixel-identical. */
export function OverviewIntro({ children }: { children: ReactNode }) {
  return (
    <section className="px-6 pt-4">
      <h2 className="text-xl mb-3" style={{ color: "var(--tan)" }}>
        Monthly Settlement Cycle
      </h2>
      <p className="text-xs mb-4 max-w-3xl" style={{ color: "var(--tan-3)" }}>
        Soter Labs' Monthly Settlement Cycle workbooks (OEA calculations, not
        Atlas figures). “To Sky” is what Primes owed Sky, not the Protocol's Net
        Revenue (A.2.3.1.2.1.1).{" "}
        <a href={SOURCE} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
          Source workbooks
        </a>
      </p>
      {children}
    </section>
  );
}

/** A typical month's worth of timeseries columns, so the card is the width
 *  it will be once the months land. */
const SKELETON_MONTHS = 8;

/** What the overview looks like before settlements.json lands: the same
 *  cards at the same sizes — the headline card with its labels and dashed
 *  figures, the timeseries card at its fixed track height, the chart card
 *  with the column headers on an empty canvas and the key — so the real
 *  charts paint into place without moving anything. Everything here is
 *  chrome; nothing needs the data. */
export function MscOverviewSkeleton() {
  const width = AXIS_W + SKELETON_MONTHS * COL_W + (SKELETON_MONTHS - 1) * GAP_PX;
  return (
    <OverviewIntro>
      <div data-testid="msc-overview-skeleton" aria-busy="true" aria-label="Loading the Monthly Settlement Cycle">
        <MscHeadline eco={null} month={null} />
        <div className="msc-overview-row flex flex-wrap items-stretch gap-x-6 gap-y-4 min-w-0">
          <div className="msc-card rounded p-4 min-w-0 max-w-full">
            <p className="text-sm mb-2" style={{ color: "var(--tan)" }}>
              To Sky by month, per Prime
            </p>
            <p className="mono text-[10px] mb-2" style={{ color: "var(--tan-3)", minHeight: "1.2em" }} />
            <svg className="msc-ts-grid" width={width} height={TRACK_H} aria-hidden="true" style={{ display: "block", position: "static" }} />
          </div>
          <div className="msc-card msc-ring-card rounded p-4 flex-1 min-w-0 flex flex-col" style={{ flexBasis: 340, maxWidth: "100%" }}>
            <p className="text-sm mb-2 flex flex-wrap items-center gap-3" style={{ color: "var(--tan)" }}>
              <span>Sky System Settlements</span>
              <MscChartStyle value="sankey" onChange={() => {}} />
            </p>
            <figure className="msc-ring-frame msc-flow-frame" aria-hidden="true">
              <svg className="msc-ring msc-flow" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="xMidYMid meet">
                <FlowHeaders />
              </svg>
            </figure>
            <RingKey view="sankey" />
          </div>
        </div>
      </div>
    </OverviewIntro>
  );
}
