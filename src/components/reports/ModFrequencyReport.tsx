import { useEffect, useMemo, useRef } from "react";
import { useLoaded } from "../../hooks/useAtlasData";
import { loadDocs } from "../../lib/docs";
import { loadModCounts } from "../../lib/history";
import { useDataSource } from "../../lib/dataSource";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { useUrlState, urlEnum } from "../../hooks/useUrlState";
import { track } from "../../lib/analytics";
import { filterRows, parseReportQuery, type ReportMode } from "../../lib/reportFilter";
import {
  buildModFrequencyRows,
  groupModFrequencyRows,
  modFrequencyRowsToCSV,
  modFrequencySearchFields,
  summarizeZeroModFrequency,
  GROUPINGS,
  type ModFrequencyGrouping,
} from "../../lib/modFrequencyIndex";
import { CategoryPills } from "./CategoryPills";
import { FilterSummary } from "./FilterSummary";
import { NoRowsMatch } from "./NoRowsMatch";
import { DownloadCsvButton } from "./DownloadCsvButton";
import { ModFrequencyTable } from "./ModFrequencyTable";
import { ModFrequencySummaryTable } from "./ModFrequencySummaryTable";

// Docs with more than this many modifications drop out of the report
// entirely — it's meant to surface rarely-touched documents, not rank every doc.
const MAX_COUNT = 1;

const groupCodec = urlEnum<ModFrequencyGrouping>("section", GROUPINGS);
const GROUP_DISPLAY: Record<ModFrequencyGrouping, string> = {
  section: "section",
  type: "doc type",
};

export function ModFrequencyReport({ query, mode }: { query: string; mode: ReportMode }) {
  useDocumentTitle("Modification Frequency: Sky Atlas by Redline");
  const { base } = useDataSource();
  const docs = useLoaded(() => loadDocs(base));
  // Wrapped so "still loading" (null) is distinguishable from "no history DB
  // on this deploy" ({ value: null }) — loadModCounts resolves null for both a
  // backend-less deploy and a transient failure, never rejects.
  const counts = useLoaded(() => loadModCounts().then((value) => ({ value })));
  const [group, setGroup] = useUrlState("group", groupCodec);

  // The full, unfiltered atlas — the per-category summary's denominator, so
  // "% never modified" reflects each category's true size, not just the
  // rarely-modified subset the doc-level table below is limited to.
  const rows = useMemo(
    () => (docs && counts?.value ? buildModFrequencyRows(docs, counts.value) : null),
    [docs, counts],
  );
  const summary = useMemo(() => (rows ? summarizeZeroModFrequency(rows, group) : null), [rows, group]);

  // The doc-level table only ever lists rarely-modified docs.
  const docRows = useMemo(() => (rows ? rows.filter((r) => r.count <= MAX_COUNT) : null), [rows]);

  const trackedView = useRef(false);
  useEffect(() => {
    if (!docRows || trackedView.current) return;
    trackedView.current = true;
    track("report_view", { report: "mod-frequency", row_count: docRows.length });
  }, [docRows]);

  const rq = useMemo(() => parseReportQuery(query, mode), [query, mode]);
  const filtered = useMemo(
    () => (docRows ? filterRows(docRows, rq, modFrequencySearchFields) : null),
    [docRows, rq],
  );
  const groups = useMemo(
    () => (filtered ? groupModFrequencyRows(filtered, group) : null),
    [filtered, group],
  );

  const onGroup = (g: ModFrequencyGrouping) => {
    setGroup(g);
    track("report_filter", { report: "mod-frequency", filter_type: "group", value: g, active: g !== "section" });
  };

  return (
    <div className="px-6 py-6">
      <div className="max-w-4xl mx-auto">
        <p className="mono text-base text-tan-3 mb-1">report</p>
        <h1 className="text-2xl font-semibold mb-1 text-tan">Modification Frequency</h1>
        <p className="text-lg text-tan-3 mb-4" style={{ maxWidth: "80ch" }}>
          How rarely each category's documents get edited, plus every document with at most{" "}
          {MAX_COUNT} modification. Only semantic content edits count: moves, renumbers, renames,
          and formatting/typo cleanups don't. Counts span the atlas's full recorded history,
          including the reconstructed pre-markdown eras.
        </p>
        {rows && (
          <div className="mb-4">
            <CategoryPills
              categories={GROUPINGS}
              active={group}
              onToggle={onGroup}
              label="Group by"
              display={GROUP_DISPLAY}
            />
          </div>
        )}
        {counts && counts.value === null ? (
          <p className="text-sm mono" style={{ color: "var(--warn)" }}>
            Modification counts come from the history database, which isn't reachable on this
            deploy. Try again later.
          </p>
        ) : !rows || !summary || !docRows || !groups ? (
          <p className="mono text-base text-tan-3">loading…</p>
        ) : (
          <>
            <ModFrequencySummaryTable summary={summary} />
            <FilterSummary query={query} searches="doc no, title, type, section" />
            {filtered && (
              <div className="flex items-center justify-between mb-4">
                <p className="mono text-xs text-tan-3">
                  {filtered.length === docRows.length
                    ? `${docRows.length} documents with ≤${MAX_COUNT} modification`
                    : `${filtered.length} of ${docRows.length} documents with ≤${MAX_COUNT} modification`}
                </p>
                <DownloadCsvButton
                  report="mod-frequency"
                  filename="modification-frequency.csv"
                  rowCount={filtered.length}
                  build={() => modFrequencyRowsToCSV(filtered)}
                  fullRowCount={docRows.length}
                  buildFull={() => modFrequencyRowsToCSV(docRows)}
                  query={query}
                />
              </div>
            )}
            {filtered && filtered.length === 0 ? (
              <NoRowsMatch query={query} />
            ) : (
              groups.map((g) => (
                <ModFrequencyTable key={g.key} group={g} rq={rq} showSection={group !== "section"} />
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}
