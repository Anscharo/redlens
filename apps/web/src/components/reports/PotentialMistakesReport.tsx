// Potential Mistakes — suspected defects in the Atlas source text.
//
// The rows are a hand-run LLM sweep (public/potential-mistakes.json); state
// and the live drift join live in usePotentialMistakesState. See
// src/lib/potentialMistakesIndex.ts.
import { MISTAKE_SEARCHES, mistakesToCSV, type MistakeRow } from "@/lib/potentialMistakesIndex";
import { type ReportMode } from "@/lib/reportFilter";
import type { ReportId } from "@/types";
import { DownloadCsvButton } from "./DownloadCsvButton";
import { MistakesFilters } from "./MistakesFilters";
import { MistakesProvenance } from "./MistakesProvenance";
import { PotentialMistakesTable } from "./PotentialMistakesTable";
import { ReportShell } from "./ReportShell";
import { mistakeFilterSummary, usePotentialMistakesState, type MistakeFilterState } from "./usePotentialMistakesState";

const REPORT: ReportId = "potential-mistakes";

function MistakesCsvButton({
  all,
  rows,
  query,
  filters: f,
}: {
  all: readonly MistakeRow[];
  rows: readonly MistakeRow[];
  query: string;
  filters: MistakeFilterState;
}) {
  return (
    <DownloadCsvButton
      report={REPORT}
      filename="potential-mistakes.csv"
      rowCount={rows.length}
      build={() => mistakesToCSV(rows)}
      fullRowCount={all.length}
      buildFull={() => mistakesToCSV(all)}
      query={query}
      filters={[f.severity, f.pass, f.status, f.category]}
    />
  );
}

export function PotentialMistakesReport({ query, mode }: { query: string; mode: ReportMode }) {
  const { file, all, filters, rq, rows, drifted, catLabels } = usePotentialMistakesState(query, mode);
  return (
    <ReportShell
      report={REPORT}
      // Chrome (title, provenance, filters) stays in the default 5xl column.
      // The table is `fullWidth` so it can use the window minus the shell's
      // px-6 gutter without stretching that column to match.
      maxWidth="max-w-5xl"
      description="Suspected typos, grammar slips, broken references and internal inconsistencies in the Atlas source text — each one quoted, explained, and linked to the document it was found in."
      query={query}
      searches={MISTAKE_SEARCHES}
      filters={mistakeFilterSummary(filters, catLabels)}
      controls={all && <MistakesFilters all={all} {...filters} />}
      count={rows ? `${rows.length} of ${all?.length ?? 0} findings` : undefined}
      actions={all && rows ? <MistakesCsvButton all={all} rows={rows} query={query} filters={filters} /> : undefined}
      loading={!rows}
      viewProps={{ row_count: all?.length ?? 0, drifted }}
      noRows={!!rows && rows.length === 0}
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
