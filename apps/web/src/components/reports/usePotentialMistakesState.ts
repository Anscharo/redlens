// URL-synced filter state + derived rows for the Potential Mistakes report.
//
// The rows are a hand-run LLM sweep (public/potential-mistakes.json), NOT
// derived from the atlas at load time. The one live computation is
// resolveMistakes(), which re-checks every finding's UUID against the atlas
// currently being served so drift is visible instead of silent.
import { useMemo } from "react";
import { loadDocs } from "../../lib/docs";
import { useLoaded } from "../../hooks/useAtlasData";
import { loadPotentialMistakes } from "../../lib/potentialMistakesLoad";
import {
  CATEGORY_LABELS,
  PASS_LABELS,
  STATUS_LABELS,
  mistakeSearchFields,
  presentCategories,
  resolveMistakes,
  type MistakePass,
  type MistakeRow,
  type MistakeSeverity,
  type MistakeStatus,
} from "@/lib/potentialMistakesIndex";
import { filterRows, type ReportMode, type ReportQuery } from "@/lib/reportFilter";
import type { ReportId } from "@/types";
import { categoryCodec } from "./CategoryPills";
import { useReportFilter, useReportQuery } from "./useReportQuery";

const REPORT: ReportId = "potential-mistakes";

// Each filter is single-select and clears on re-click, so they all use the
// shared nullable enum codec keyed by its own label map.
const SEVERITY_LABELS: Record<MistakeSeverity, string> = { high: "high", medium: "medium", low: "low" };
const sevCodec = categoryCodec(SEVERITY_LABELS);
const passCodec = categoryCodec(PASS_LABELS);
const statusCodec = categoryCodec(STATUS_LABELS);
const catCodec = categoryCodec(CATEGORY_LABELS);

/** The four pill filters, named to match MistakesFilters' props. */
function useMistakeFilters() {
  const [severity, onSeverity] = useReportFilter<MistakeSeverity>(REPORT, "sev", sevCodec, "severity");
  const [pass, onPass] = useReportFilter<MistakePass>(REPORT, "pass", passCodec);
  const [status, onStatus] = useReportFilter<MistakeStatus>(REPORT, "status", statusCodec);
  const [category, onCategory] = useReportFilter<string>(REPORT, "cat", catCodec, "category");
  return { severity, onSeverity, pass, onPass, status, onStatus, category, onCategory };
}

export type MistakeFilterState = ReturnType<typeof useMistakeFilters>;

function useFilteredMistakes(all: MistakeRow[] | null, f: MistakeFilterState, rq: ReportQuery) {
  const { severity, pass, status, category } = f;
  return useMemo(() => {
    if (!all) return null;
    const picked = all.filter(
      (r) =>
        (!severity || r.severity === severity) &&
        (!pass || r.pass === pass) &&
        (!status || r.status === status) &&
        (!category || r.category === category),
    );
    return filterRows(picked, rq, mistakeSearchFields);
  }, [all, severity, pass, status, category, rq]);
}

function useCategoryLabels(all: MistakeRow[] | null): Record<string, string> {
  return useMemo(
    () => Object.fromEntries((all ? presentCategories(all) : []).map((c) => [c, CATEGORY_LABELS[c] ?? c])),
    [all],
  );
}

/** Filter-summary chips for the shell, one per active pill. */
export function mistakeFilterSummary(f: MistakeFilterState, catLabels: Record<string, string>) {
  return [
    f.severity && `severity: ${f.severity}`,
    f.pass && `pass: ${PASS_LABELS[f.pass]}`,
    f.status && `status: ${STATUS_LABELS[f.status]}`,
    f.category && `category: ${catLabels[f.category] ?? f.category}`,
  ];
}

export function usePotentialMistakesState(query: string, mode: ReportMode) {
  const file = useLoaded(loadPotentialMistakes);
  const docs = useLoaded(loadDocs);
  // Live join against the served atlas — the only part of this report that is
  // not frozen at sweep time.
  const all = useMemo(() => (file && docs ? resolveMistakes(file, docs) : null), [file, docs]);
  const filters = useMistakeFilters();
  const rq = useReportQuery(query, mode);
  const rows = useFilteredMistakes(all, filters, rq);
  const drifted = useMemo(
    () => all?.filter((r) => r.status === "renumbered" || r.status === "missing").length ?? 0,
    [all],
  );
  const catLabels = useCategoryLabels(all);
  return { file, all, filters, rq, rows, drifted, catLabels };
}
