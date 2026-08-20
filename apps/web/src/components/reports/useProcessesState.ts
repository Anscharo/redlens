// URL-synced filter state + derived rows for the Processes report, pulled out
// of ProcessesReport.tsx so the page file is chrome + table only (mirrors
// useRoleReportState for the role reports).
import { useMemo } from "react";
import { urlBool, urlString } from "../../hooks/useUrlState";
import { loadAtlas } from "../../lib/docs";
import { loadProcesses, buildProcessRows, indexByParentDocNo, type ProcessRow } from "../../lib/processesIndex";
import { useLoaded } from "../../hooks/useAtlasData";
import { useLocalIgnores } from "../../hooks/useLocalIgnores";
import { filterRows, type ReportMode, type SearchField } from "@/lib/reportFilter";
import type { ReportId } from "@/types";
import { SHAPE_VALUES, STATUS_VALUES } from "./ProcessesFilters";
import { useReportEnum, useReportFilter, useReportQuery, useReportSwitch } from "./useReportQuery";

// Header-box text filter: title + doc number. Category/status/shape are
// pill-owned and deliberately excluded.
const searchFields = (r: ProcessRow): SearchField[] => [
  { label: "title", value: r.title },
  { label: "doc no", value: r.docNo },
];

const REPORT: ReportId = "processes";
const categoryCodec = urlString(null);
const ignoredCodec = urlBool(false);

export function useProcessesState(query: string, mode: ReportMode) {
  const atlas = useLoaded(loadAtlas);
  const processes = useLoaded(loadProcesses);

  const [status, toggleStatus] = useReportEnum(REPORT, "status", "all", STATUS_VALUES);
  const [shape, toggleShape] = useReportEnum(REPORT, "shape", "all", SHAPE_VALUES);
  const [category, toggleCategory] = useReportFilter(REPORT, "category", categoryCodec);
  const [showIgnored, toggleShowIgnored] = useReportSwitch(REPORT, "ignored", ignoredCodec, "show_ignored");

  const { marks, byUuid: ignoresByUuid, mark, unmark, clear } = useLocalIgnores();
  const rq = useReportQuery(query, mode);

  const childrenByParentDocNo = useMemo(() => (atlas ? indexByParentDocNo(atlas.docs) : new Map()), [atlas]);
  const rows = useMemo(() => (atlas && processes ? buildProcessRows(atlas.docs, processes) : []), [atlas, processes]);
  const categories = useMemo(() => [...new Set(rows.map((r) => r.category))].sort(), [rows]);

  const filtered = useMemo(() => {
    const base = rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (shape !== "all" && r.shape !== shape) return false;
      if (category && r.category !== category) return false;
      if (!showIgnored && ignoresByUuid.has(r.uuid)) return false;
      return true;
    });
    return filterRows(base, rq, searchFields);
  }, [rows, status, shape, category, showIgnored, ignoresByUuid, rq]);

  const byCategory = useMemo(() => {
    const map = new Map<string, ProcessRow[]>();
    for (const r of filtered) {
      const list = map.get(r.category) ?? [];
      list.push(r);
      map.set(r.category, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.docNo.localeCompare(b.docNo, undefined, { numeric: true }));
    return map;
  }, [filtered]);

  return {
    atlas,
    loading: !atlas || !processes,
    rq,
    rows,
    filtered,
    byCategory,
    categories,
    childrenByParentDocNo,
    status,
    toggleStatus,
    shape,
    toggleShape,
    category,
    toggleCategory,
    showIgnored,
    toggleShowIgnored,
    ignores: { marks, byUuid: ignoresByUuid, mark, unmark, clear },
  };
}
