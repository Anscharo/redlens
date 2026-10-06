// The Processes report page: the curated process inventory grouped by
// category, with URL-synced filters, CSV export, and an expandable row per
// process.
import { useHydrateAddressMap } from "../../hooks/useHydrateAddressMap";
import { type ReportMode } from "@/lib/reportFilter";
import type { ReportId } from "@/types";
import { ProcessesCategoryTables } from "./ProcessesCategoryTables";
import { ProcessesControls } from "./ProcessesControls";
import { ProcessesCsvButton } from "./ProcessesCsvButton";
import { ReportShell } from "./ReportShell";
import { useExpandedProcess } from "./useExpandedProcess";
import { useProcessesState } from "./useProcessesState";

const REPORT: ReportId = "processes";

function ProcessesDescription({ rowCount, categoryCount }: { rowCount: number; categoryCount: number }) {
  return (
    <>
      The curated inventory of governance, settlement, lifecycle, and operational processes — {rowCount}{" "}
      entries across {categoryCount} categories. Maintained via the{" "}
      <code className="mono text-xs">processes-triage</code> skill on each atlas update. Click a row to
      expand.
    </>
  );
}

export function ProcessesReport({ query, mode }: { query: string; mode: ReportMode }) {
  // Curated explorer URLs for addresses in process docs on direct visits.
  useHydrateAddressMap();
  const s = useProcessesState(query, mode);
  const docs = s.atlas?.docs;
  const [expandedUuid, toggleExpanded] = useExpandedProcess(s.loading);

  return (
    <ReportShell
      report={REPORT}
      maxWidth="max-w-6xl"
      description={<ProcessesDescription rowCount={s.rows.length} categoryCount={s.categories.length} />}
      controls={<ProcessesControls state={s} />}
      query={query}
      filters={[s.category, s.status !== "all" && `status:${s.status}`, s.shape !== "all" && `shape:${s.shape}`]}
      count={s.loading ? undefined : `${s.filtered.length} processes`}
      actions={s.loading ? undefined : <ProcessesCsvButton report={REPORT} state={s} query={query} />}
      loading={s.loading}
      viewProps={{ row_count: s.rows.length }}
      noRows={!s.loading && s.filtered.length === 0}
    >
      {docs && <ProcessesCategoryTables state={s} docs={docs} expandedUuid={expandedUuid} onToggle={toggleExpanded} />}
    </ReportShell>
  );
}
