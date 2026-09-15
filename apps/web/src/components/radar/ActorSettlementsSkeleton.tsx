import { MscHeadline } from "./MscHeadline";

/** A typical run of published months, so the bar charts are their final
 *  width before the workbooks land. */
const SKELETON_MONTHS = 6;

function EmptyBars({ cluster }: { cluster: boolean }) {
  return (
    <div className={cluster ? "mb-4" : undefined}>
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
    </div>
  );
}

/** A Prime's settlement page before settlements.json lands: the intro's
 *  height, the card of monthly-summary bar charts as empty tracks at their
 *  real size, then the headline card with dashed figures, so the loaded
 *  page paints into place. */
export function ActorSettlementsSkeleton() {
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
          className="mono text-[10px] uppercase tracking-wider mb-2"
          style={{ color: "var(--tan-3)" }}
        >
          monthly summary
        </h2>
        <div className="msc-charts-meta">
          <h3 className="text-sm font-medium m-0" style={{ color: "var(--tan)" }}>
            Trailing {SKELETON_MONTHS} Months
          </h3>
          <p className="m-0 text-sm" style={{ color: "var(--tan-2)" }}>
            Agent earnings
          </p>
        </div>
        <p className="msc-charts-legend mono text-[10px] mb-2" style={{ color: "var(--tan-3)", minHeight: "1.2em" }} />
        <EmptyBars cluster />
        <EmptyBars cluster={false} />
      </section>
      <MscHeadline eco={null} month={null} labels={{ kept: "Supply-side kept", demand: "Demand-side" }} />
    </div>
  );
}
