import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLoaded } from "../../hooks/useAtlasData";
import { loadDocs } from "../../lib/docs";
import { loadModCounts } from "../../lib/history";
import { loadGraph } from "../../lib/graph";
import { buildOwningAgentMap } from "../../lib/owningAgent";
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
  modFrequencySummaryToCSV,
  summarizeModFrequencyMatches,
  GROUPINGS,
  FREQUENCY_COMPARATORS,
  FREQUENCY_MIN,
  FREQUENCY_MAX,
  type ModFrequencyGrouping,
} from "../../lib/modFrequencyIndex";
import { buildModCountHistogram, type ModCountBucket } from "../../lib/modFrequencyCharts";
import { CategoryPills } from "./CategoryPills";
import { FilterSummary } from "./FilterSummary";
import { NoRowsMatch } from "./NoRowsMatch";
import { DownloadCsvButton } from "./DownloadCsvButton";
import { SingleDownloadButton } from "./SingleDownloadButton";
import { ModFrequencyTable } from "./ModFrequencyTable";
import { ModFrequencySummaryTable } from "./ModFrequencySummaryTable";
import { ModFrequencyHistogram } from "./ModFrequencyHistogram";
import { ModFrequencyTimeline } from "./ModFrequencyTimeline";
import { ModFrequencyTabs, MOD_FREQUENCY_TABS, type ModFrequencyTab } from "./ModFrequencyTabs";
import { useModFrequencyFilter, comparatorDisplay } from "./useModFrequencyFilter";
import { useModFrequencyTimeline, TIMELINE_GRANULARITIES, GRANULARITY_DISPLAY } from "./useModFrequencyTimeline";

const groupCodec = urlEnum<ModFrequencyGrouping>("section", GROUPINGS);
const GROUP_DISPLAY: Record<ModFrequencyGrouping, string> = {
  section: "section",
  type: "doc type",
};

const tabCodec = urlEnum<ModFrequencyTab>("timeline", MOD_FREQUENCY_TABS);

export function ModFrequencyReport({ query, mode }: { query: string; mode: ReportMode }) {
  useDocumentTitle("Modification Frequency: Sky Atlas by Redline");
  const { base, preview } = useDataSource();
  const docs = useLoaded(() => loadDocs(base));
  // Wrapped so "still loading" (null) is distinguishable from "no history DB
  // on this deploy" ({ value: null }) — loadModCounts resolves null for both a
  // backend-less deploy and a transient failure, never rejects.
  const counts = useLoaded(() => loadModCounts().then((value) => ({ value })));
  const timeline = useModFrequencyTimeline();
  // soft: the A.6-by-agent sub-split is an enrichment, not core to the report —
  // a graph load failure shouldn't block the rest of the page. Always reads the
  // live-atlas base (like AtlasView's cousins/relations), so hide it in preview
  // (its node ids describe the live atlas, not the preview bundle `docs` came
  // from) rather than mismatching agents to the wrong docs.
  const graph = useLoaded(loadGraph, { soft: true });
  const docNoToId = useMemo(() => {
    if (!docs) return null;
    return new Map(Object.values(docs).map((d) => [d.doc_no, d.id]));
  }, [docs]);
  const agentByDoc = useMemo(() => {
    if (!docs || !docNoToId) return new Map<string, string>();
    return buildOwningAgentMap({ docs, docNoToId }, preview ? null : graph);
  }, [docs, docNoToId, preview, graph]);
  const [tab, setTab] = useUrlState("tab", tabCodec);
  const [group, setGroup] = useUrlState("group", groupCodec);
  const filter = useModFrequencyFilter();

  const rq = useMemo(() => parseReportQuery(query, mode), [query, mode]);

  // Every derived value below is a synchronous function of `docs`/`counts` —
  // one guard (`!view`) covers them all, instead of a separate nullable memo
  // (and null-check) per value. Both groupings are always computed (not just
  // the one the List tab's "Group by" pills currently show) so the Sum By tab
  // can display and download section and type breakdowns side by side; the
  // histogram is built from the full, unfiltered atlas so it reflects each
  // bucket's true size, not just the doc-level table's filtered subset.
  const view = useMemo(() => {
    if (!docs || !counts?.value) return null;
    const rows = buildModFrequencyRows(docs, counts.value, agentByDoc);
    const summaryBySection = summarizeModFrequencyMatches(rows, "section", (r) => filter.matchesFilter(r.count));
    const summaryByType = summarizeModFrequencyMatches(rows, "type", (r) => filter.matchesFilter(r.count));
    const histogram = buildModCountHistogram(rows);
    const docRows = rows.filter((r) => filter.matchesFilter(r.count));
    const filtered = filterRows(docRows, rq, modFrequencySearchFields);
    const groups = groupModFrequencyRows(filtered, group);
    return { rows, summaryBySection, summaryByType, histogram, docRows, filtered, groups };
  }, [docs, counts, agentByDoc, filter.matchesFilter, rq, group]);

  const isBucketIncluded = useCallback((b: ModCountBucket) => filter.matchesFilter(b.count), [filter.matchesFilter]);

  const trackedView = useRef(false);
  useEffect(() => {
    if (!view || trackedView.current) return;
    trackedView.current = true;
    track("report_view", { report: "mod-frequency", row_count: view.docRows.length });
  }, [view]);

  const onTab = (t: ModFrequencyTab) => {
    setTab(t);
    track("report_filter", { report: "mod-frequency", filter_type: "tab", value: t, active: t !== "timeline" });
  };
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
          How rarely each category's documents get edited, plus a filterable list of documents by
          edit frequency — rarely-touched, or flipped to the most heavily revised. Only semantic
          content edits count: moves, renumbers, renames, and formatting/typo cleanups don't.
          Counts span the atlas's full recorded history, including the reconstructed pre-markdown
          eras.
        </p>
        {view && (
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <CategoryPills
              categories={FREQUENCY_COMPARATORS}
              active={filter.comparator}
              onToggle={filter.onComparator}
              label="Show"
              display={comparatorDisplay(filter.threshold)}
            />
            <label className="flex items-center gap-1.5 text-xs text-tan-3">
              Edits
              <input
                type="number"
                min={FREQUENCY_MIN}
                max={FREQUENCY_MAX}
                value={filter.thresholdInput}
                onChange={(e) => filter.setThresholdInput(e.target.value)}
                onBlur={(e) => filter.commitThreshold(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                className="w-14 px-1.5 py-0.5 rounded border bg-transparent mono text-xs text-tan"
                style={{ borderColor: "var(--border)" }}
              />
            </label>
          </div>
        )}

        <ModFrequencyTabs active={tab} onChange={onTab} />

        {counts && counts.value === null ? (
          <p className="text-sm mono" style={{ color: "var(--warn)" }}>
            Modification counts come from the history database, which isn't reachable on this
            deploy. Try again later.
          </p>
        ) : !view ? (
          <p className="mono text-base text-tan-3">loading…</p>
        ) : (
          <>
            {tab === "timeline" && (
              <>
                <div className="mb-4">
                  <CategoryPills
                    categories={TIMELINE_GRANULARITIES}
                    active={timeline.granularity}
                    onToggle={timeline.onGranularity}
                    label="Group by"
                    display={GRANULARITY_DISPLAY}
                  />
                </div>
                {timeline.buckets ? (
                  <ModFrequencyTimeline buckets={timeline.buckets} title={timeline.title} />
                ) : (
                  <p className="mono text-xs text-tan-3">No edit timeline available.</p>
                )}
              </>
            )}

            {tab === "sum-by" && (
              <>
                <section className="mb-8">
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-xs mono text-tan-3 uppercase tracking-wider">By section</h2>
                    <SingleDownloadButton
                      report="mod-frequency-summary-section"
                      filename="modification-frequency-by-section.csv"
                      rowCount={view.summaryBySection.length}
                      build={() => modFrequencySummaryToCSV(view.summaryBySection)}
                      label="Download by section (CSV)"
                    />
                  </div>
                  <ModFrequencySummaryTable summary={view.summaryBySection} matchLabel={filter.filterLabel} />
                </section>
                <section className="mb-8">
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-xs mono text-tan-3 uppercase tracking-wider">By document type</h2>
                    <SingleDownloadButton
                      report="mod-frequency-summary-type"
                      filename="modification-frequency-by-type.csv"
                      rowCount={view.summaryByType.length}
                      build={() => modFrequencySummaryToCSV(view.summaryByType)}
                      label="Download by type (CSV)"
                    />
                  </div>
                  <ModFrequencySummaryTable summary={view.summaryByType} matchLabel={filter.filterLabel} />
                </section>
              </>
            )}

            {tab === "list" && (
              <>
                <ModFrequencyHistogram buckets={view.histogram} isIncluded={isBucketIncluded} />
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
                <div className="flex items-center justify-between mb-4">
                  <p className="mono text-xs text-tan-3">
                    {view.filtered.length === view.docRows.length
                      ? `${view.docRows.length} documents with ${filter.filterLabel}`
                      : `${view.filtered.length} of ${view.docRows.length} documents with ${filter.filterLabel}`}
                  </p>
                  <DownloadCsvButton
                    report="mod-frequency"
                    filename="modification-frequency.csv"
                    rowCount={view.filtered.length}
                    build={() => modFrequencyRowsToCSV(view.filtered)}
                    fullRowCount={view.docRows.length}
                    buildFull={() => modFrequencyRowsToCSV(view.docRows)}
                    query={query}
                    filters={[filter.thresholdActive && filter.filterLabel]}
                  />
                </div>
                {view.filtered.length === 0 ? (
                  <NoRowsMatch query={query} />
                ) : (
                  view.groups.map((g) => (
                    <ModFrequencyTable key={g.key} group={g} rq={rq} showSection={group !== "section"} />
                  ))
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
