import { type ReportMode } from "@/lib/reportFilter";
import type { ReportId } from "@/types";
import { ModFrequencyControls, ModFrequencyTimelinePanel } from "./ModFrequencyControls";
import { ModFrequencyList } from "./ModFrequencyList";
import { ModFrequencySumBy } from "./ModFrequencySumBy";
import { ReportShell } from "./ReportShell";
import { useModFrequencyState } from "./useModFrequencyState";

const REPORT: ReportId = "mod-frequency";

const DESCRIPTION = (
  <>
    How rarely each category's documents get edited, plus a filterable list of documents by edit
    frequency — rarely-touched, or flipped to the most heavily revised. Only semantic content edits
    count: moves, renumbers, renames, and formatting/typo cleanups don't. Counts span the atlas's full
    recorded history, including the reconstructed pre-markdown eras.
  </>
);

function DbUnreachable() {
  return (
    <p className="text-sm mono" style={{ color: "var(--warn)" }}>
      Modification counts come from the history database, which isn't reachable on this deploy. Try again later.
    </p>
  );
}

export function ModFrequencyReport({ query, mode }: { query: string; mode: ReportMode }) {
  const { timeline, tab, setTab, filter, view, dbUnreachable, sumBy, list } = useModFrequencyState(query, mode);
  return (
    <ReportShell
      report={REPORT}
      maxWidth="max-w-4xl"
      description={DESCRIPTION}
      controls={<ModFrequencyControls filter={filter} showFilter={!!view} tab={tab} onTab={setTab} />}
      query={query}
      loading={!view && !dbUnreachable}
      ready={!!view}
      viewProps={{ row_count: view?.list.docRows.length ?? 0 }}
    >
      {dbUnreachable ? (
        <DbUnreachable />
      ) : (
        view && (
          <>
            {tab === "timeline" && <ModFrequencyTimelinePanel timeline={timeline} />}
            {tab === "sum-by" && sumBy && <ModFrequencySumBy {...sumBy} />}
            {tab === "list" && list && <ModFrequencyList {...list} />}
          </>
        )
      )}
    </ReportShell>
  );
}
