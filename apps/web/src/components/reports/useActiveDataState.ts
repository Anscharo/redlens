// Data/filter-state hooks backing ActiveDataReport.tsx: the URL-synced
// Scope/Entity filters, the loaded rows, the pill lists derived from them,
// and the last-edit dates the table and CSV show.
import { useState, useMemo, useEffect } from "react";
import { urlString } from "../../hooks/useUrlState";
import { loadDocs } from "../../lib/docs";
import { loadGraph } from "../../lib/graph";
import { loadHistoryBatch } from "@/lib/history";
import { useLoaded } from "../../hooks/useAtlasData";
import { buildActiveDataRows, adSearchFields, type ActiveDataRow } from "@/lib/activeDataIndex";
import { filterRows, type ReportMode } from "@/lib/reportFilter";
import type { ReportId } from "@/types";
import { useReportFilter, useReportQuery } from "./useReportQuery";

const agentCodec = urlString(null);
const entityCodec = urlString(null);

// Last history entry date per Active Data doc, keyed by its UUID.
function useLastEditDates(rows: ActiveDataRow[]) {
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
  return lastEditDates;
}

// Agents are derived from the rows themselves (graph-resolved in buildActiveDataRows).
// Order by the first appearance of each agent — rows are pre-sorted by doc_no, which
// keeps prime agents in their natural atlas order.
function scopeAgents(rows: ActiveDataRow[]): string[] {
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
}

// Unique names for the Entity filter: responsible parties + facilitators.
// (Descriptive declarations like "entity to which the registration
// pertains" never reach here — the graph extractor excludes them, and the
// row shows them via declaredRP instead of a ResponsibleParty entity.)
function entityNamesOf(rows: ActiveDataRow[]): string[] {
  const names = new Set<string>();
  rows.forEach((r) => {
    if (r.responsibleParty?.name) names.add(r.responsibleParty.name);
    if (r.facilitator?.name) names.add(r.facilitator.name);
  });
  return [...names].sort();
}

function matchesFilters(r: ActiveDataRow, agentFilter: string | null, entityFilter: string | null): boolean {
  if (agentFilter === "Governance" && r.agent !== null) return false;
  if (agentFilter && agentFilter !== "Governance" && r.agent !== agentFilter) return false;
  if (entityFilter) {
    const match = r.responsibleParty?.name === entityFilter || r.facilitator?.name === entityFilter;
    if (!match) return false;
  }
  return true;
}

export function useActiveDataState(report: ReportId, introDocUuid: string, query: string, mode: ReportMode) {
  const docs = useLoaded(loadDocs);
  const graph = useLoaded(loadGraph);
  const rows = useMemo(() => (docs && graph ? buildActiveDataRows(docs, graph) : []), [docs, graph]);
  const [agentFilter, toggleAgent] = useReportFilter(report, "agent", agentCodec);
  const [entityFilter, toggleEntity] = useReportFilter(report, "entity", entityCodec);
  const lastEditDates = useLastEditDates(rows);
  const agents = useMemo(() => scopeAgents(rows), [rows]);
  const entityNames = useMemo(() => entityNamesOf(rows), [rows]);
  const filtered = useMemo(
    () => rows.filter((r) => matchesFilters(r, agentFilter, entityFilter)),
    [rows, agentFilter, entityFilter],
  );
  const rq = useReportQuery(query, mode);
  const shown = useMemo(() => filterRows(filtered, rq, adSearchFields), [filtered, rq]);
  const introDocNo = docs?.[introDocUuid]?.doc_no;
  const pills = { agents, agentFilter, onAgent: toggleAgent, entityNames, entityFilter, onEntity: toggleEntity };
  return { rows, shown, rq, lastEditDates, introDocNo, pills, filters: [agentFilter, entityFilter] };
}
