// Potential Mistakes — suspected defects in the Atlas source text.
//
// The rows are a hand-run LLM sweep (public/potential-mistakes.json),
// NOT derived from the atlas at load time. The one live computation is
// resolveMistakes(), which re-checks every finding's UUID against the atlas
// currently being served so drift is visible instead of silent. See
// src/lib/potentialMistakesIndex.ts.
import { useMemo } from "react";
import { loadDocs } from "../../lib/docs";
import { useLoaded } from "../../hooks/useAtlasData";
import { loadPotentialMistakes } from "../../lib/potentialMistakesLoad";
import {
  CATEGORY_LABELS,
  MISTAKE_SEARCHES,
  PASSES,
  PASS_LABELS,
  SEVERITIES,
  STATUS_LABELS,
  countBy,
  mistakeSearchFields,
  mistakesToCSV,
  presentCategories,
  resolveMistakes,
  type MistakePass,
  type MistakeSeverity,
  type MistakeStatus,
} from "@/lib/potentialMistakesIndex";
import { filterRows, type ReportMode } from "@/lib/reportFilter";
import type { ReportId } from "@/types";
import { CategoryPills, categoryCodec } from "./CategoryPills";
import { DownloadCsvButton } from "./DownloadCsvButton";
import { MistakesProvenance } from "./MistakesProvenance";
import { PotentialMistakesTable } from "./PotentialMistakesTable";
import { ReportShell } from "./ReportShell";
import { useReportFilter, useReportQuery } from "./useReportQuery";

const REPORT: ReportId = "potential-mistakes";
const STATUSES: readonly MistakeStatus[] = ["current", "renumbered", "missing", "corpus"];

// Each filter is single-select and clears on re-click, so they all use the
// shared nullable enum codec keyed by its own label map.
const SEVERITY_LABELS: Record<MistakeSeverity, string> = { high: "high", medium: "medium", low: "low" };
const sevCodec = categoryCodec(SEVERITY_LABELS);
const passCodec = categoryCodec(PASS_LABELS);
const statusCodec = categoryCodec(STATUS_LABELS);
const catCodec = categoryCodec(CATEGORY_LABELS);

export function PotentialMistakesReport({ query, mode }: { query: string; mode: ReportMode }) {
  const file = useLoaded(loadPotentialMistakes);
  const docs = useLoaded(loadDocs);

  // Live join against the served atlas — the only part of this report that is
  // not frozen at sweep time.
  const all = useMemo(() => (file && docs ? resolveMistakes(file, docs) : null), [file, docs]);

  const [severity, toggleSeverity] = useReportFilter<MistakeSeverity>(REPORT, "sev", sevCodec, "severity");
  const [pass, togglePass] = useReportFilter<MistakePass>(REPORT, "pass", passCodec);
  const [status, toggleStatus] = useReportFilter<MistakeStatus>(REPORT, "status", statusCodec);
  const [category, toggleCategory] = useReportFilter<string>(REPORT, "cat", catCodec, "category");

  const rq = useReportQuery(query, mode);
  const rows = useMemo(() => {
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

  const drifted = useMemo(
    () => all?.filter((r) => r.status === "renumbered" || r.status === "missing").length ?? 0,
    [all],
  );
  const cats = useMemo(() => (all ? presentCategories(all) : []), [all]);
  const catLabels = useMemo(
    () => Object.fromEntries(cats.map((c) => [c, CATEGORY_LABELS[c] ?? c])),
    [cats],
  );

  const loading = !all || !rows;
  return (
    <ReportShell
      report={REPORT}
      title="Potential Mistakes"
      // Chrome stays in the default column. The table is `fullWidth` so it can
      // use the window minus the shell's px-6 gutter without stretching the
      // provenance copy (capped at 80ch) to match.
      maxWidth="max-w-5xl"
      description="Suspected typos, grammar slips, broken references and internal inconsistencies in the Atlas source text — each one quoted, explained, and linked to the document it was found in."
      query={query}
      searches={MISTAKE_SEARCHES}
      filters={[
        severity && `severity: ${severity}`,
        pass && `pass: ${PASS_LABELS[pass]}`,
        status && `status: ${STATUS_LABELS[status]}`,
        category && `category: ${catLabels[category] ?? category}`,
      ]}
      controls={
        all && (
          <div className="flex flex-col gap-1.5 mb-4">
            <CategoryPills
              categories={SEVERITIES}
              active={severity}
              onToggle={toggleSeverity}
              label="Severity"
              labelTitle="How confident the sweep was that this is a real defect — not how damaging it would be."
              counts={countBy(all, (r) => r.severity)}
              showSingle
            />
            <CategoryPills
              categories={cats}
              active={category}
              onToggle={toggleCategory}
              label="Category"
              display={catLabels}
              counts={countBy(all, (r) => r.category)}
            />
            <CategoryPills
              categories={PASSES}
              active={pass}
              onToggle={togglePass}
              label="Found by"
              labelTitle="Which sweep pass reported the finding: a language read, a consistency read, or a mechanical scan."
              display={PASS_LABELS}
              counts={countBy(all, (r) => r.pass)}
            />
            <CategoryPills
              categories={STATUSES}
              active={status}
              onToggle={toggleStatus}
              label="Doc status"
              labelTitle="Checked live against the Atlas being served right now — findings whose document moved or vanished since the sweep."
              display={STATUS_LABELS}
              counts={countBy(all, (r) => r.status)}
            />
          </div>
        )
      }
      count={rows ? `${rows.length} of ${all?.length ?? 0} findings` : undefined}
      actions={
        all && rows ? (
          <DownloadCsvButton
            report={REPORT}
            filename="potential-mistakes.csv"
            rowCount={rows.length}
            build={() => mistakesToCSV(rows)}
            fullRowCount={all.length}
            buildFull={() => mistakesToCSV(all)}
            query={query}
            filters={[severity, pass, status, category]}
          />
        ) : undefined
      }
      loading={loading}
      viewProps={{ row_count: all?.length ?? 0, drifted }}
      noRows={!loading && rows.length === 0}
      fullWidth={rows && rows.length > 0 ? <PotentialMistakesTable rows={rows} rq={rq} /> : undefined}
    >
      {file && all && (
        <MistakesProvenance
          generatedAt={file.generatedAt}
          atlasSha={file.atlasSha}
          documentsScanned={file.documentsScanned}
          total={all.length}
          drifted={drifted}
        />
      )}
    </ReportShell>
  );
}
