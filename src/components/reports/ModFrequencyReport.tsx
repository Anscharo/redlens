import { useCallback, useMemo } from "react";
import { useLoaded } from "../../hooks/useAtlasData";
import { loadDocs } from "../../lib/docs";
import { loadModCounts } from "../../lib/history";
import { loadGraph } from "../../lib/graph";
import { buildOwningAgentMap } from "../../lib/owningAgent";
import { useDataSource } from "../../lib/dataSource";
import { filterRows, type ReportMode } from "../../lib/reportFilter";
import {
  buildModFrequencyRows,
  groupModFrequencyRows,
  modFrequencySearchFields,
  summarizeModFrequencyMatches,
  GROUPINGS,
  type ModFrequencyGrouping,
} from "../../lib/modFrequencyIndex";
import { buildModCountHistogram, type ModCountBucket } from "../../lib/modFrequencyCharts";
import type { ReportId } from "../../types";
import { ModFrequencyControls, ModFrequencyTimelinePanel } from "./ModFrequencyControls";
import { ModFrequencyList } from "./ModFrequencyList";
import { ModFrequencySumBy } from "./ModFrequencySumBy";
import { MOD_FREQUENCY_TABS, type ModFrequencyTab } from "./ModFrequencyTabs";
import { ReportShell } from "./ReportShell";
import { useModFrequencyFilter } from "./useModFrequencyFilter";
import { useModFrequencyTimeline } from "./useModFrequencyTimeline";
import { useReportQuery, useReportSelect } from "./useReportQuery";

const REPORT: ReportId = "mod-frequency";

export function ModFrequencyReport({ query, mode }: { query: string; mode: ReportMode }) {
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
  const [tab, setTab] = useReportSelect<ModFrequencyTab>(REPORT, "tab", "timeline", MOD_FREQUENCY_TABS);
  const [group, setGroup] = useReportSelect<ModFrequencyGrouping>(REPORT, "group", "section", GROUPINGS);
  const filter = useModFrequencyFilter();

  const rq = useReportQuery(query, mode);

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
  const dbUnreachable = !!counts && counts.value === null;

  return (
    <ReportShell
      report={REPORT}
      title="Modification Frequency"
      maxWidth="max-w-4xl"
      description={
        <>
          How rarely each category's documents get edited, plus a filterable list of documents by edit
          frequency — rarely-touched, or flipped to the most heavily revised. Only semantic content edits
          count: moves, renumbers, renames, and formatting/typo cleanups don't. Counts span the atlas's full
          recorded history, including the reconstructed pre-markdown eras.
        </>
      }
      controls={<ModFrequencyControls filter={filter} showFilter={!!view} tab={tab} onTab={setTab} />}
      query={query}
      loading={!view && !dbUnreachable}
      ready={!!view}
      viewProps={{ row_count: view?.docRows.length ?? 0 }}
    >
      {dbUnreachable ? (
        <p className="text-sm mono" style={{ color: "var(--warn)" }}>
          Modification counts come from the history database, which isn't reachable on this deploy. Try again
          later.
        </p>
      ) : (
        view && (
          <>
            {tab === "timeline" && <ModFrequencyTimelinePanel timeline={timeline} />}
            {tab === "sum-by" && (
              <ModFrequencySumBy
                bySection={view.summaryBySection}
                byType={view.summaryByType}
                matchLabel={filter.filterLabel}
              />
            )}
            {tab === "list" && (
              <ModFrequencyList
                histogram={view.histogram}
                isBucketIncluded={isBucketIncluded}
                group={group}
                onGroup={setGroup}
                query={query}
                rq={rq}
                docRows={view.docRows}
                filtered={view.filtered}
                groups={view.groups}
                filterLabel={filter.filterLabel}
                thresholdActive={filter.thresholdActive}
              />
            )}
          </>
        )
      )}
    </ReportShell>
  );
}
