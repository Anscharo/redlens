// Page chrome shared by every /reports/* page: eyebrow + title (one size for
// all reports), intro copy, the pill area, the filter callout, the result
// count + CSV row, and the loading / no-rows states — plus the document title
// and the `report_view` event, so neither can be forgotten on a new report.
//
// Slot order is fixed on purpose: title → description → controls (pills) →
// filter summary → count + actions → body. Pages that need a full-bleed region
// (a wide table with its own scroll container) pass it as `fullWidth`, which
// renders outside the centered column.
import type { ReactNode } from "react";
import type { ReportId } from "../../types";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { FilterSummary } from "./FilterSummary";
import { NoRowsMatch } from "./NoRowsMatch";
import { useReportView } from "./useReportQuery";

export interface ReportShellProps {
  /** Analytics slug + report id (also the `report` property on every event). */
  report: ReportId;
  /** h1 text. The document title defaults to "<title>: Sky Atlas by Redline". */
  title: string;
  documentTitle?: string;
  description?: ReactNode;
  /** Second, muted line under the description (e.g. the assessment provenance). */
  note?: ReactNode;
  noteTitle?: string;
  /** Tailwind max-width class for the centered column. */
  maxWidth?: string;
  /** Pill groups / filter controls. */
  controls?: ReactNode;
  query: string;
  filters?: (string | false | null | undefined)[];
  searches?: string;
  /** Result count: a plain string gets the standard styling; a node renders as-is. */
  count?: ReactNode;
  /** Right side of the count row — normally <DownloadCsvButton/>. */
  actions?: ReactNode;
  loading?: boolean;
  /** Fire `report_view` once this is true (defaults to "not loading"). */
  ready?: boolean;
  /** Extra properties merged into `report_view` (row counts, rubric version…). */
  viewProps?: Record<string, unknown>;
  /** Render the shared "no rows match" line above the body. */
  noRows?: boolean;
  children?: ReactNode;
  /** Rendered full-bleed, after the centered column (wide scrolling tables). */
  fullWidth?: ReactNode;
}

/** The result-count + CSV row. ReportShell renders it in its standard slot;
 *  exported for the one page (Modification Frequency) whose count belongs
 *  inside a tab panel rather than above it. */
export function ReportCountRow({ count, actions }: { count?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
      <div className="flex items-center gap-3 flex-wrap">
        {typeof count === "string" ? <p className="mono text-xs text-tan-3">{count}</p> : count}
      </div>
      {actions}
    </div>
  );
}

export function ReportShell({
  report,
  title,
  documentTitle,
  description,
  note,
  noteTitle,
  maxWidth = "max-w-5xl",
  controls,
  query,
  filters,
  searches,
  count,
  actions,
  loading = false,
  ready,
  viewProps,
  noRows = false,
  children,
  fullWidth,
}: ReportShellProps) {
  useDocumentTitle(documentTitle ?? `${title}: Sky Atlas by Redline`);
  useReportView(report, ready ?? !loading, viewProps);
  const showCountRow = count != null || actions != null;

  return (
    <div className="px-6 py-6">
      <div className={`${maxWidth} mx-auto`}>
        <p className="mono text-xs text-tan-3 mb-1">report</p>
        <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--tan)" }}>
          {title}
        </h1>
        {description && (
          <p className={`text-sm text-tan-3 ${note ? "mb-1" : "mb-5"}`}>{description}</p>
        )}
        {note && (
          <p className="mono text-xs text-tan-3 mb-4" title={noteTitle}>
            {note}
          </p>
        )}
        {controls}
        <FilterSummary query={query} filters={filters} searches={searches} />
        {showCountRow && <ReportCountRow count={count} actions={actions} />}
        {loading ? (
          <p className="mono text-xs text-tan-3">Loading…</p>
        ) : (
          <>
            {noRows && <NoRowsMatch query={query} />}
            {children}
          </>
        )}
      </div>
      {!loading && fullWidth}
    </div>
  );
}
