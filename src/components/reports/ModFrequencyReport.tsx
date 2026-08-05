import { useCallback, useEffect, useMemo, useRef } from "react";
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
  buildModCountHistogram,
  groupModFrequencyRows,
  modFrequencyRowsToCSV,
  modFrequencySearchFields,
  percentileThreshold,
  summarizeZeroModFrequency,
  GROUPINGS,
  FILTER_MODES,
  RARE_MAX_OPTIONS,
  FREQUENT_PERCENT_OPTIONS,
  type ModCountBucket,
  type ModFrequencyGrouping,
  type ModFrequencyFilterMode,
} from "../../lib/modFrequencyIndex";
import { CategoryPills } from "./CategoryPills";
import { FilterSummary } from "./FilterSummary";
import { NoRowsMatch } from "./NoRowsMatch";
import { DownloadCsvButton } from "./DownloadCsvButton";
import { ModFrequencyTable } from "./ModFrequencyTable";
import { ModFrequencySummaryTable } from "./ModFrequencySummaryTable";
import { ModFrequencyHistogram } from "./ModFrequencyHistogram";

const groupCodec = urlEnum<ModFrequencyGrouping>("section", GROUPINGS);
const GROUP_DISPLAY: Record<ModFrequencyGrouping, string> = {
  section: "section",
  type: "doc type",
};

const filterModeCodec = urlEnum<ModFrequencyFilterMode>("rare", FILTER_MODES);
const FILTER_MODE_DISPLAY: Record<ModFrequencyFilterMode, string> = {
  rare: "rarely modified",
  frequent: "frequently modified",
};

const RARE_MAX_STRS = RARE_MAX_OPTIONS.map(String);
const rareMaxCodec = urlEnum<string>("1", RARE_MAX_STRS);
const RARE_MAX_DISPLAY: Record<string, string> = Object.fromEntries(RARE_MAX_OPTIONS.map((n) => [String(n), `≤${n}`]));

const FREQUENT_PERCENT_STRS = FREQUENT_PERCENT_OPTIONS.map(String);
const freqPercentCodec = urlEnum<string>("20", FREQUENT_PERCENT_STRS);
const FREQUENT_PERCENT_DISPLAY: Record<string, string> = Object.fromEntries(
  FREQUENT_PERCENT_OPTIONS.map((n) => [String(n), `top ${n}%`]),
);

export function ModFrequencyReport({ query, mode }: { query: string; mode: ReportMode }) {
  useDocumentTitle("Modification Frequency: Sky Atlas by Redline");
  const { base } = useDataSource();
  const docs = useLoaded(() => loadDocs(base));
  // Wrapped so "still loading" (null) is distinguishable from "no history DB
  // on this deploy" ({ value: null }) — loadModCounts resolves null for both a
  // backend-less deploy and a transient failure, never rejects.
  const counts = useLoaded(() => loadModCounts().then((value) => ({ value })));
  const [group, setGroup] = useUrlState("group", groupCodec);
  const [filterMode, setFilterMode] = useUrlState("filter", filterModeCodec);
  const [rareMaxStr, setRareMaxStr] = useUrlState("rare-max", rareMaxCodec);
  const [freqPercentStr, setFreqPercentStr] = useUrlState("freq-pct", freqPercentCodec);
  const rareMax = Number(rareMaxStr);
  const freqPercent = Number(freqPercentStr);

  // The full, unfiltered atlas — the per-category summary's denominator and
  // the histogram's source, so both reflect each category/bucket's true
  // size, not just the doc-level table's filtered subset.
  const rows = useMemo(
    () => (docs && counts?.value ? buildModFrequencyRows(docs, counts.value) : null),
    [docs, counts],
  );
  const summary = useMemo(() => (rows ? summarizeZeroModFrequency(rows, group) : null), [rows, group]);
  const histogram = useMemo(() => (rows ? buildModCountHistogram(rows) : null), [rows]);

  // "Rare" keeps count <= rareMax; "frequent" keeps count above the count
  // value at the chosen top-N% cutoff of the live distribution.
  const threshold = useMemo(() => {
    if (!rows) return null;
    return filterMode === "rare" ? rareMax : percentileThreshold(rows, freqPercent);
  }, [rows, filterMode, rareMax, freqPercent]);

  const docRows = useMemo(() => {
    if (!rows || threshold === null) return null;
    return filterMode === "rare"
      ? rows.filter((r) => r.count <= threshold)
      : rows.filter((r) => r.count > threshold);
  }, [rows, filterMode, threshold]);

  const isBucketIncluded = useCallback(
    (b: ModCountBucket) =>
      threshold !== null && (filterMode === "rare" ? b.count <= threshold : b.count > threshold),
    [filterMode, threshold],
  );

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
  const onFilterMode = (m: ModFrequencyFilterMode) => {
    setFilterMode(m);
    track("report_filter", { report: "mod-frequency", filter_type: "filter_mode", value: m, active: m !== "rare" });
  };
  const onRareMax = (v: string) => {
    setRareMaxStr(v);
    track("report_filter", { report: "mod-frequency", filter_type: "rare_max", value: v, active: v !== "1" });
  };
  const onFreqPercent = (v: string) => {
    setFreqPercentStr(v);
    track("report_filter", { report: "mod-frequency", filter_type: "freq_percent", value: v, active: v !== "20" });
  };

  const filterLabel =
    filterMode === "rare"
      ? `≤${rareMax} modification${rareMax === 1 ? "" : "s"}`
      : `more than ${threshold ?? 0} modification${(threshold ?? 0) === 1 ? "" : "s"} (top ${freqPercent}%)`;

  return (
    <div className="px-6 py-6">
      <div className="max-w-4xl mx-auto">
        <p className="mono text-base text-tan-3 mb-1">report</p>
        <h1 className="text-2xl font-semibold mb-1 text-tan">Modification Frequency</h1>
        <p className="text-lg text-tan-3 mb-4" style={{ maxWidth: "80ch" }}>
          How rarely each category's documents get edited, plus a filterable list of documents by
          edit frequency — rarely-touched, or flipped to the most heavily revised. Only semantic
          content edits count: moves, renumbers, renames, and formatting/typo cleanups don't.
          Counts span the atlas's full recorded history, including the reconstructed pre-markdown
          eras.
        </p>
        {rows && histogram && <ModFrequencyHistogram buckets={histogram} isIncluded={isBucketIncluded} />}
        {rows && (
          <div className="mb-2">
            <CategoryPills
              categories={GROUPINGS}
              active={group}
              onToggle={onGroup}
              label="Group by"
              display={GROUP_DISPLAY}
            />
          </div>
        )}
        {rows && (
          <div className="mb-4 flex flex-wrap gap-x-4 gap-y-2">
            <CategoryPills
              categories={FILTER_MODES}
              active={filterMode}
              onToggle={onFilterMode}
              label="Show"
              display={FILTER_MODE_DISPLAY}
            />
            {filterMode === "rare" ? (
              <CategoryPills
                categories={RARE_MAX_STRS}
                active={rareMaxStr}
                onToggle={onRareMax}
                label="Edits"
                display={RARE_MAX_DISPLAY}
              />
            ) : (
              <CategoryPills
                categories={FREQUENT_PERCENT_STRS}
                active={freqPercentStr}
                onToggle={onFreqPercent}
                label="Cutoff"
                display={FREQUENT_PERCENT_DISPLAY}
              />
            )}
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
                    ? `${docRows.length} documents with ${filterLabel}`
                    : `${filtered.length} of ${docRows.length} documents with ${filterLabel}`}
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
