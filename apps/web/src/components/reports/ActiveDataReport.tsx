import { useState, useMemo, useEffect } from "react";
import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "@/lib/routes";
import { urlString } from "../../hooks/useUrlState";
import { loadDocs } from "../../lib/docs";
import { loadGraph } from "../../lib/graph";
import { loadHistoryBatch } from "@/lib/history";
import { useLoaded } from "../../hooks/useAtlasData";
import { buildActiveDataRows, activeDataRowsToCSV, adSearchFields } from "@/lib/activeDataIndex";
import { filterRows, type ReportMode } from "@/lib/reportFilter";
import type { ReportId } from "@/types";
import { CategoryPills } from "./CategoryPills";
import { DownloadCsvButton } from "./DownloadCsvButton";
import { ReportShell } from "./ReportShell";
import { ActiveDataTable } from "./ActiveDataTable";
import { useReportFilter, useReportQuery } from "./useReportQuery";

const REPORT: ReportId = "active-data";
// A.1.13 Updating Active Data — the doc_no is resolved from the atlas at
// render (it moves whenever the atlas is renumbered); only the UUID is fixed.
const INTRO_DOC_UUID = "75e8fd51-a540-4c3a-aaa9-1a38502f89b2";
const agentCodec = urlString(null);
const entityCodec = urlString(null);

// adSearchFields (the row search haystack) lives in the lib module so the
// atlas_report_active_data MCP tool filters rows with the same field logic.
const SEARCHES =
  "title · doc nos · controller · prime agent · process · responsible party (incl. declared text) · facilitator (incl. role) · agent chain (executor/facilitator/govops)";

export function ActiveDataReport({ query, mode }: { query: string; mode: ReportMode }) {
  const docs = useLoaded(loadDocs);
  const graph = useLoaded(loadGraph);
  const rows = useMemo(() => (docs && graph ? buildActiveDataRows(docs, graph) : []), [docs, graph]);
  const [agentFilter, toggleAgent] = useReportFilter(REPORT, "agent", agentCodec);
  const [entityFilter, toggleEntity] = useReportFilter(REPORT, "entity", entityCodec);
  const [lastEditDates, setLastEditDates] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!rows.length) return;
    let cancelled = false;
    loadHistoryBatch(rows.map((r) => r.activeDataId)).then((byDoc) => {
      if (cancelled) return;
      const m = new Map<string, string>();
      for (const r of rows) {
        const entries = byDoc.get(r.activeDataId);
        if (entries?.length) m.set(r.activeDataId, entries[entries.length - 1].date);
      }
      setLastEditDates(m);
    });
    return () => {
      cancelled = true;
    };
  }, [rows]);

  // Agents are derived from the rows themselves (graph-resolved in buildActiveDataRows).
  // Order by the first appearance of each agent — rows are pre-sorted by doc_no, which
  // keeps prime agents in their natural atlas order.
  const agents = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = ["Governance"];
    for (const r of rows) {
      const name = r.agent;
      if (name && !seen.has(name)) {
        seen.add(name);
        ordered.push(name);
      }
    }
    return ordered.filter((a) => (a === "Governance" ? rows.some((r) => r.agent === null) : true));
  }, [rows]);

  // Unique names for the Entity filter: responsible parties + facilitators.
  // (Descriptive declarations like "entity to which the registration
  // pertains" never reach here — the graph extractor excludes them, and the
  // row shows them via declaredRP instead of a ResponsibleParty entity.)
  const entityNames = useMemo(() => {
    const names = new Set<string>();
    rows.forEach((r) => {
      if (r.responsibleParty?.name) names.add(r.responsibleParty.name);
      if (r.facilitator?.name) names.add(r.facilitator.name);
    });
    return [...names].sort();
  }, [rows]);

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (agentFilter === "Governance" && r.agent !== null) return false;
        if (agentFilter && agentFilter !== "Governance" && r.agent !== agentFilter) return false;
        if (entityFilter) {
          const match = r.responsibleParty?.name === entityFilter || r.facilitator?.name === entityFilter;
          if (!match) return false;
        }
        return true;
      }),
    [rows, agentFilter, entityFilter],
  );
  const rq = useReportQuery(query, mode);
  const shown = useMemo(() => filterRows(filtered, rq, adSearchFields), [filtered, rq]);
  const introDocNo = docs?.[INTRO_DOC_UUID]?.doc_no;

  return (
    <ReportShell
      report={REPORT}
      title="Active Data Index"
      maxWidth="max-w-7xl"
      description={
        <>
          All Active Data sections with full responsibility chain — sourced from the Atlas graph.{" "}
          <AtlasLink to={atlasHref(INTRO_DOC_UUID)} className="text-accent hover:underline">
            {introDocNo ? `${introDocNo} ` : ""}Updating Active Data ↗
          </AtlasLink>
        </>
      }
      controls={
        <div className="mb-6 flex flex-col gap-3">
          <CategoryPills label="Scope" categories={agents} active={agentFilter} onToggle={toggleAgent} showSingle />
          <CategoryPills label="Entity" categories={entityNames} active={entityFilter} onToggle={toggleEntity} showSingle />
        </div>
      }
      query={query}
      filters={[agentFilter, entityFilter]}
      searches={SEARCHES}
      count={`${shown.length} sections`}
      actions={
        <DownloadCsvButton
          report={REPORT}
          filename="active-data-index.csv"
          rowCount={shown.length}
          build={() => activeDataRowsToCSV(shown, lastEditDates)}
          fullRowCount={rows.length}
          buildFull={() => activeDataRowsToCSV(rows, lastEditDates)}
          query={query}
          filters={[agentFilter, entityFilter]}
        />
      }
      ready={rows.length > 0}
      viewProps={{ row_count: rows.length }}
      noRows={rows.length > 0 && shown.length === 0}
    >
      <ActiveDataTable rows={shown} rq={rq} lastEditDates={lastEditDates} />
    </ReportShell>
  );
}
