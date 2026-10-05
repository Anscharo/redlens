// URL-synced filter state + derived rows for the Processes report, so the page
// file is chrome + table only (mirrors useRoleReportState for the role reports).
import { useMemo } from "react";
import { urlBool, urlString } from "../../hooks/useUrlState";
import { loadAtlas } from "../../lib/docs";
import { buildProcessRows, indexByParentDocNo, processSearchFields, type ProcessRow } from "@/lib/processesIndex";
import { loadProcesses } from "../../lib/processesLoad";
import { useLoaded } from "../../hooks/useAtlasData";
import { useLocalIgnores } from "../../hooks/useLocalIgnores";
import { filterRows, type ReportMode } from "@/lib/reportFilter";
import type { ReportId } from "@/types";
import { SHAPE_VALUES, STATUS_VALUES } from "./ProcessesFilters";
import { useReportEnum, useReportFilter, useReportQuery, useReportSwitch } from "./useReportQuery";

const REPORT: ReportId = "processes";
const categoryCodec = urlString(null);
const ignoredCodec = urlBool(false);

type ProcessFilters = ReturnType<typeof useProcessFilters>;

/** The four pill filters, each in its own URL param. */
function useProcessFilters() {
  const [status, toggleStatus] = useReportEnum(REPORT, "status", "all", STATUS_VALUES);
  const [shape, toggleShape] = useReportEnum(REPORT, "shape", "all", SHAPE_VALUES);
  const [category, toggleCategory] = useReportFilter(REPORT, "category", categoryCodec);
  const [showIgnored, toggleShowIgnored] = useReportSwitch(REPORT, "ignored", ignoredCodec, "show_ignored");
  return { status, toggleStatus, shape, toggleShape, category, toggleCategory, showIgnored, toggleShowIgnored };
}

/** Process rows joined to the atlas, plus the lookups the expanded rows and category pills read. */
function useProcessRows() {
  const atlas = useLoaded(loadAtlas);
  const processes = useLoaded(loadProcesses);
  const childrenByParentDocNo = useMemo(() => (atlas ? indexByParentDocNo(atlas.docs) : new Map()), [atlas]);
  const rows = useMemo(() => (atlas && processes ? buildProcessRows(atlas.docs, processes) : []), [atlas, processes]);
  const categories = useMemo(() => [...new Set(rows.map((r) => r.category))].sort(), [rows]);
  return { atlas, loading: !atlas || !processes, rows, categories, childrenByParentDocNo };
}

type PillValues = Pick<ProcessFilters, "status" | "shape" | "category" | "showIgnored">;

function matchesPills(r: ProcessRow, f: PillValues, ignoresByUuid: Map<string, unknown>): boolean {
  if (f.status !== "all" && r.status !== f.status) return false;
  if (f.shape !== "all" && r.shape !== f.shape) return false;
  if (f.category && r.category !== f.category) return false;
  return f.showIgnored || !ignoresByUuid.has(r.uuid);
}

/** Rows per category, each list in doc-number order. */
function groupByCategory(rows: readonly ProcessRow[]): Map<string, ProcessRow[]> {
  const map = new Map<string, ProcessRow[]>();
  for (const r of rows) {
    const list = map.get(r.category);
    if (list) list.push(r);
    else map.set(r.category, [r]);
  }
  for (const list of map.values()) list.sort((a, b) => a.docNo.localeCompare(b.docNo, undefined, { numeric: true }));
  return map;
}

export function useProcessesState(query: string, mode: ReportMode) {
  const data = useProcessRows();
  const f = useProcessFilters();
  const { marks, byUuid: ignoresByUuid, mark, unmark, clear } = useLocalIgnores();
  const rq = useReportQuery(query, mode);
  const { status, shape, category, showIgnored } = f;
  const pills = useMemo(() => ({ status, shape, category, showIgnored }), [status, shape, category, showIgnored]);
  const filtered = useMemo(
    () => filterRows(data.rows.filter((r) => matchesPills(r, pills, ignoresByUuid)), rq, processSearchFields),
    [data.rows, pills, ignoresByUuid, rq],
  );
  const byCategory = useMemo(() => groupByCategory(filtered), [filtered]);
  return { ...data, ...f, rq, filtered, byCategory, ignores: { marks, byUuid: ignoresByUuid, mark, unmark, clear } };
}
