// The "Sum By" tab of the Modification Frequency report: the per-section and
// per-document-type share of documents matching the edit-count filter, each
// downloadable on its own.
import type { ModFrequencySummaryRow } from "@/lib/modFrequencyIndex";
import { modFrequencySummaryToCSV } from "@/lib/modFrequencyIndex";
import { ModFrequencySummaryTable } from "./ModFrequencySummaryTable";
import { SingleDownloadButton } from "./SingleDownloadButton";

function Section({
  title,
  summary,
  matchLabel,
  report,
  filename,
  label,
}: {
  title: string;
  summary: ModFrequencySummaryRow[];
  matchLabel: string;
  report: string;
  filename: string;
  label: string;
}) {
  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs mono text-tan-3 uppercase tracking-wider">{title}</h2>
        <SingleDownloadButton
          report={report}
          filename={filename}
          rowCount={summary.length}
          build={() => modFrequencySummaryToCSV(summary)}
          label={label}
        />
      </div>
      <ModFrequencySummaryTable summary={summary} matchLabel={matchLabel} />
    </section>
  );
}

export function ModFrequencySumBy({
  bySection,
  byType,
  matchLabel,
}: {
  bySection: ModFrequencySummaryRow[];
  byType: ModFrequencySummaryRow[];
  matchLabel: string;
}) {
  return (
    <>
      <Section
        title="By section"
        summary={bySection}
        matchLabel={matchLabel}
        report="mod-frequency-summary-section"
        filename="modification-frequency-by-section.csv"
        label="Download by section (CSV)"
      />
      <Section
        title="By document type"
        summary={byType}
        matchLabel={matchLabel}
        report="mod-frequency-summary-type"
        filename="modification-frequency-by-type.csv"
        label="Download by type (CSV)"
      />
    </>
  );
}
