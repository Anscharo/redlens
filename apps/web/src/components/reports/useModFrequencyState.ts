// Data loading, URL state and derived rows for the Modification Frequency
// report. Returns ready-made prop bundles for the Sum By and List tabs so the
// page is tab switching + <ReportShell> only.
import { useCallback, useMemo } from "react";
import { useLoaded } from "../../hooks/useAtlasData";
import { loadDocs } from "../../lib/docs";
import { loadModCounts, type ModCount } from "@/lib/history";
import { loadGraph } from "../../lib/graph";
import { buildOwningAgentMap } from "../../lib/owningAgent";
import { useDataSource, type DataSource } from "../../lib/dataSource";
import { filterRows, type ReportMode, type ReportQuery } from "@/lib/reportFilter";
import {
  buildModFrequencyRows,
  groupModFrequencyRows,
  modFrequencySearchFields,
  summarizeModFrequencyMatches,
  GROUPINGS,
  type ModFrequencyGrouping,
} from "../../lib/modFrequencyIndex";
import { buildModCountHistogram, type ModCountBucket } from "../../lib/modFrequencyCharts";
import type { AtlasNode, ReportId } from "@/types";
import { MOD_FREQUENCY_TABS, type ModFrequencyTab } from "./ModFrequencyTabs";
import { useModFrequencyFilter } from "./useModFrequencyFilter";
import { useModFrequencyTimeline } from "./useModFrequencyTimeline";
import { useReportQuery, useReportSelect } from "./useReportQuery";

const REPORT: ReportId = "mod-frequency";

// soft: the A.6-by-agent sub-split is an enrichment, not core to the report —
// a graph load failure shouldn't block the rest of the page. Always reads the
// live-atlas base (like AtlasView's cousins/relations), so hide it in preview
// (its node ids describe the live atlas, not the preview bundle `docs` came
// from) rather than mismatching agents to the wrong docs.
function useAgentByDoc(docs: Record<string, AtlasNode> | null, preview: DataSource["preview"]) {
  const graph = useLoaded(loadGraph, { soft: true });
  const docNoToId = useMemo(() => {
    if (!docs) return null;
    return new Map(Object.values(docs).map((d) => [d.doc_no, d.id]));
  }, [docs]);
  return useMemo(() => {
    if (!docs || !docNoToId) return new Map<string, string>();
    return buildOwningAgentMap({ docs, docNoToId }, preview ? null : graph);
  }, [docs, docNoToId, preview, graph]);
}

// Both groupings are always computed (not just the one the List tab's "Group
// by" pills currently show) so the Sum By tab can display and download section
// and type breakdowns side by side; the histogram is built from the full,
// unfiltered atlas so it reflects each bucket's true size, not just the
// doc-level table's filtered subset.
function buildView(
  rows: ReturnType<typeof buildModFrequencyRows>,
  matches: (count: number) => boolean,
  rq: ReportQuery,
  group: ModFrequencyGrouping,
) {
  const docRows = rows.filter((r) => matches(r.count));
  const filtered = filterRows(docRows, rq, modFrequencySearchFields);
  const bySection = summarizeModFrequencyMatches(rows, "section", (r) => matches(r.count));
  const byType = summarizeModFrequencyMatches(rows, "type", (r) => matches(r.count));
  const histogram = buildModCountHistogram(rows);
  return {
    sumBy: { bySection, byType },
    list: { histogram, docRows, filtered, groups: groupModFrequencyRows(filtered, group) },
  };
}

// Every derived value is a synchronous function of `docs`/`counts` — one
// guard (`!view`) covers them all, instead of a separate nullable memo (and
// null-check) per value.
function useModFrequencyView(
  docs: Record<string, AtlasNode> | null,
  preview: DataSource["preview"],
  counts: { value: ModCount[] | null } | null,
  rq: ReportQuery,
) {
  const agentByDoc = useAgentByDoc(docs, preview);
  const [tab, setTab] = useReportSelect<ModFrequencyTab>(REPORT, "tab", "timeline", MOD_FREQUENCY_TABS);
  const [group, setGroup] = useReportSelect<ModFrequencyGrouping>(REPORT, "group", "section", GROUPINGS);
  const filter = useModFrequencyFilter();
  const { matchesFilter } = filter;
  const view = useMemo(() => {
    if (!docs || !counts?.value) return null;
    return buildView(buildModFrequencyRows(docs, counts.value, agentByDoc), matchesFilter, rq, group);
  }, [docs, counts, agentByDoc, matchesFilter, rq, group]);
  const isBucketIncluded = useCallback((b: ModCountBucket) => matchesFilter(b.count), [matchesFilter]);
  return { tab, setTab, group, setGroup, filter, view, isBucketIncluded };
}

export function useModFrequencyState(query: string, mode: ReportMode) {
  const { base, preview } = useDataSource();
  const docs = useLoaded(() => loadDocs(base));
  // Wrapped so "still loading" (null) is distinguishable from "no history DB
  // on this deploy" ({ value: null }) — loadModCounts resolves null for both a
  // backend-less deploy and a transient failure, never rejects.
  const counts = useLoaded(() => loadModCounts().then((value) => ({ value })));
  const timeline = useModFrequencyTimeline();
  const rq = useReportQuery(query, mode);
  const v = useModFrequencyView(docs, preview, counts, rq);
  const { tab, setTab, group, setGroup, filter, view, isBucketIncluded } = v;
  const { filterLabel, thresholdActive } = filter;
  const dbUnreachable = !!counts && counts.value === null;
  const sumBy = view && { ...view.sumBy, matchLabel: filterLabel };
  const list = view && {
    ...view.list,
    isBucketIncluded, group, onGroup: setGroup, query, rq, filterLabel, thresholdActive,
  };
  return { timeline, tab, setTab, filter, view, dbUnreachable, sumBy, list };
}
