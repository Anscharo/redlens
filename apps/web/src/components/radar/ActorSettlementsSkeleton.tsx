import { MscHeadline } from "./MscHeadline";

/** A typical run of published months, so the bar charts are their final
 *  width before the workbooks land. */
const SKELETON_MONTHS = 6;

const TITLE = "mono text-[10px] uppercase tracking-wider mb-2";

function EmptyBars({ cluster }: { cluster: boolean }) {
  return (
    <div className="flex items-end gap-3 mb-2" aria-hidden="true">
      {Array.from({ length: SKELETON_MONTHS }, (_, i) => (
        <span key={i} className="msc-bar-col">
          {cluster ? (
            <span className="msc-bar-cluster">
              <span className="msc-bar-track" />
              <span className="msc-bar-track" />
              <span className="msc-bar-track" />
            </span>
          ) : (
            <span className="msc-bar-stack" />
          )}
          <span className="mono text-[10px]">—</span>
        </span>
      ))}
    </div>
  );
}

/** A Prime's settlement page before settlements.json lands: the intro's
 *  height, the card of monthly-summary bar charts as empty tracks at their
 *  real size, then the headline card with dashed figures, so the loaded
 *  page paints into place. */
export function ActorSettlementsSkeleton({ name }: { name: string }) {
  return (
    <div data-testid="settlements-skeleton" aria-busy="true" aria-label="Loading the Monthly Settlement Cycle">
      <p className="text-xs mb-4" style={{ color: "var(--tan-3)" }}>
        Soter Labs' Monthly Settlement Cycle workbooks (OEA calculations, not
        Atlas figures). “To Sky” is what this Prime owed Sky, not the Protocol’s
        Net Revenue (A.2.3.1.2.1.1).
      </p>
      <section className="msc-card rounded p-4 mb-4" aria-labelledby="msc-charts-heading">
        <h2
          id="msc-charts-heading"
          className="text-sm font-medium m-0 mb-3"
          style={{ color: "var(--tan)" }}
        >
          Trailing {SKELETON_MONTHS} Months – Total {name} earnings
        </h2>
        <div className="msc-charts-row">
          <div className="msc-charts-pane">
            <h3 className={TITLE} style={{ color: "var(--tan-3)" }}>
              monthly summary
            </h3>
            <p className="msc-charts-legend mono text-[10px] mb-2" style={{ color: "var(--tan-3)", minHeight: "1.2em" }} />
            <EmptyBars cluster />
          </div>
          <div className="msc-charts-pane">
            <h3 className={TITLE} style={{ color: "var(--tan-3)" }}>
              demand side
            </h3>
            <p className="msc-charts-legend mono text-[10px] mb-2" style={{ color: "var(--tan-3)", minHeight: "1.2em" }} />
            <EmptyBars cluster={false} />
          </div>
        </div>
      </section>
      <MscHeadline eco={null} month={null} earner={name} />
    </div>
  );
}
