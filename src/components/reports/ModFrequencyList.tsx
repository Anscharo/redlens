// The "List" tab of the Modification Frequency report: the edit-count
// histogram, the grouping pills, and the matching documents. The count + CSV
// row lives inside the tab (not in ReportShell's slot) because it describes
// this tab's rows, not the page.
import {
  modFrequencyRowsToCSV,
  GROUPINGS,
  type ModFrequencyGroup,
  type ModFrequencyGrouping,
  type ModFrequencyRow,
} from "../../lib/modFrequencyIndex";
import type { ModCountBucket } from "../../lib/modFrequencyCharts";
import type { ReportQuery } from "../../lib/reportFilter";
import { CategoryPills } from "./CategoryPills";
import { DownloadCsvButton } from "./DownloadCsvButton";
import { FilterSummary } from "./FilterSummary";
import { ModFrequencyHistogram } from "./ModFrequencyHistogram";
import { ModFrequencyTable } from "./ModFrequencyTable";
import { NoRowsMatch } from "./NoRowsMatch";
import { ReportCountRow } from "./ReportShell";

const GROUP_DISPLAY: Record<ModFrequencyGrouping, string> = { section: "section", type: "doc type" };

export function ModFrequencyList({
  histogram,
  isBucketIncluded,
  group,
  onGroup,
  query,
  rq,
  docRows,
  filtered,
  groups,
  filterLabel,
  thresholdActive,
}: {
  histogram: ModCountBucket[];
  isBucketIncluded: (b: ModCountBucket) => boolean;
  group: ModFrequencyGrouping;
  onGroup: (g: ModFrequencyGrouping) => void;
  query: string;
  rq: ReportQuery;
  docRows: readonly ModFrequencyRow[];
  filtered: readonly ModFrequencyRow[];
  groups: ModFrequencyGroup[];
  filterLabel: string;
  thresholdActive: boolean;
}) {
  const count =
    filtered.length === docRows.length
      ? `${docRows.length} documents with ${filterLabel}`
      : `${filtered.length} of ${docRows.length} documents with ${filterLabel}`;
  return (
    <>
      <ModFrequencyHistogram buckets={histogram} isIncluded={isBucketIncluded} />
      <div className="mb-4">
        <CategoryPills
          categories={GROUPINGS}
          active={group}
          onToggle={onGroup}
          label="Group by"
          display={GROUP_DISPLAY}
        />
      </div>
      <FilterSummary query={query} searches="doc no, title, type, section" />
      <ReportCountRow
        count={count}
        actions={
          <DownloadCsvButton
            report="mod-frequency"
            filename="modification-frequency.csv"
            rowCount={filtered.length}
            build={() => modFrequencyRowsToCSV(filtered)}
            fullRowCount={docRows.length}
            buildFull={() => modFrequencyRowsToCSV(docRows)}
            query={query}
            filters={[thresholdActive && filterLabel]}
          />
        }
      />
      {filtered.length === 0 ? (
        <NoRowsMatch query={query} />
      ) : (
        groups.map((g) => <ModFrequencyTable key={g.key} group={g} rq={rq} showSection={group !== "section"} />)
      )}
    </>
  );
}
