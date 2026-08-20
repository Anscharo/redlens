import { useEffect } from "react";
import { useSearchParams } from "wouter";
import { processRowsToCSV } from "../../lib/processesIndex";
import { useHydrateAddressMap } from "../../hooks/useHydrateAddressMap";
import { type ReportMode } from "@/lib/reportFilter";
import type { ReportId } from "@/types";
import { DownloadCsvButton } from "./DownloadCsvButton";
import { ProcessesFilters } from "./ProcessesFilters";
import { ProcessesTable } from "./ProcessesTable";
import { ReportShell } from "./ReportShell";
import { useProcessesState } from "./useProcessesState";

const REPORT: ReportId = "processes";

export function ProcessesReport({ onNavigate, query, mode }: { onNavigate: (id: string) => void; query: string; mode: ReportMode }) {
  // Curated explorer URLs for addresses in process docs on direct visits.
  useHydrateAddressMap();
  const s = useProcessesState(query, mode);
  const { byUuid: ignoresByUuid } = s.ignores;
  const docs = s.atlas?.docs;

  // URL is the source of truth for the expanded row. Bookmarkable + back/forward
  // navigation drives expansion via useSearchParams. The post-render useEffect
  // below scrolls the row into view on initial load and on toggle.
  const [searchParams, setSearchParams] = useSearchParams();
  const expandedUuid = searchParams.get("expanded");

  // After rows render, scroll the expanded row into view. Handles both the
  // initial page-load case (when the row didn't exist yet for the browser's
  // own hash-anchor scroll) and subsequent toggles.
  useEffect(() => {
    if (s.loading || !expandedUuid) return;
    requestAnimationFrame(() => {
      document.getElementById(expandedUuid)?.scrollIntoView({ behavior: "instant" as ScrollBehavior });
    });
  }, [s.loading, expandedUuid]);

  const toggleExpanded = (uuid: string) => {
    const next = expandedUuid === uuid ? null : uuid;
    setSearchParams((prev) => {
      const np = new URLSearchParams(prev);
      if (next) np.set("expanded", next);
      else np.delete("expanded");
      return np;
    });
  };

  return (
    <ReportShell
      report={REPORT}
      title="Atlas Processes"
      maxWidth="max-w-6xl"
      description={
        <>
          The curated inventory of governance, settlement, lifecycle, and operational processes — {s.rows.length}{" "}
          entries across {s.categories.length} categories. Maintained via the{" "}
          <code className="mono text-xs">processes-triage</code> skill on each atlas update. Click a row to
          expand.
        </>
      }
      controls={
        <ProcessesFilters
          marks={s.ignores.marks}
          onClearMarks={s.ignores.clear}
          showIgnored={s.showIgnored}
          onToggleShowIgnored={s.toggleShowIgnored}
          categories={s.categories}
          category={s.category}
          onCategory={s.toggleCategory}
          status={s.status}
          onStatus={s.toggleStatus}
          shape={s.shape}
          onShape={s.toggleShape}
        />
      }
      query={query}
      filters={[s.category, s.status !== "all" && `status:${s.status}`, s.shape !== "all" && `shape:${s.shape}`]}
      count={s.loading ? undefined : `${s.filtered.length} processes`}
      actions={
        s.loading ? undefined : (
          <DownloadCsvButton
            report={REPORT}
            filename="atlas-processes.csv"
            rowCount={s.filtered.length}
            build={() => processRowsToCSV(s.filtered, ignoresByUuid)}
            fullRowCount={s.rows.length}
            buildFull={() => processRowsToCSV(s.rows, ignoresByUuid)}
            query={query}
            filters={[s.category, s.status !== "all" && s.status, s.shape !== "all" && s.shape, s.showIgnored && "show ignored"]}
          />
        )
      }
      loading={s.loading}
      viewProps={{ row_count: s.rows.length }}
      noRows={!s.loading && s.filtered.length === 0}
    >
      {docs &&
        [...s.byCategory.entries()].map(([category, list]) => (
          <ProcessesTable
            key={category}
            category={category}
            rows={list}
            docs={docs}
            childrenByParentDocNo={s.childrenByParentDocNo}
            expandedUuid={expandedUuid}
            onToggle={toggleExpanded}
            onNavigate={onNavigate}
            ignoresByUuid={ignoresByUuid}
            onMark={s.ignores.mark}
            onUnmark={s.ignores.unmark}
            rq={s.rq}
          />
        ))}
    </ReportShell>
  );
}
