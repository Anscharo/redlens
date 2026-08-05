import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLoaded } from "../../hooks/useAtlasData";
import { loadDocs } from "../../lib/docs";
import { loadModCounts } from "../../lib/history";
import { loadGraph } from "../../lib/graph";
import { buildOwningAgentMap } from "../../lib/owningAgent";
import { useDataSource } from "../../lib/dataSource";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { useUrlState, urlEnum, urlInt } from "../../hooks/useUrlState";
import { track } from "../../lib/analytics";
import { filterRows, parseReportQuery, type ReportMode } from "../../lib/reportFilter";
import {
  buildModFrequencyRows,
  buildModCountHistogram,
  groupModFrequencyRows,
  matchesFrequency,
  modFrequencyRowsToCSV,
  modFrequencySearchFields,
  summarizeModFrequencyMatches,
  GROUPINGS,
  FREQUENCY_COMPARATORS,
  FREQUENCY_MIN,
  FREQUENCY_MAX,
  FREQUENCY_DEFAULT,
  type ModCountBucket,
  type ModFrequencyGrouping,
  type FrequencyComparator,
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

const comparatorCodec = urlEnum<FrequencyComparator>("lte", FREQUENCY_COMPARATORS);
const thresholdCodec = urlInt(FREQUENCY_DEFAULT);

// Pill text bakes in the live threshold — "Least Frequent (≤1 edit)" reads as
// a preview of what the pill currently selects, not just a static label.
function comparatorDisplay(threshold: number): Record<FrequencyComparator, string> {
  const edit = `edit${threshold === 1 ? "" : "s"}`;
  return {
    lte: `Least Frequent (≤${threshold} ${edit})`,
    gt: `Most Frequent (>${threshold} ${edit})`,
  };
}

export function ModFrequencyReport({ query, mode }: { query: string; mode: ReportMode }) {
  useDocumentTitle("Modification Frequency: Sky Atlas by Redline");
  const { base, preview } = useDataSource();
  const docs = useLoaded(() => loadDocs(base));
  // Wrapped so "still loading" (null) is distinguishable from "no history DB
  // on this deploy" ({ value: null }) — loadModCounts resolves null for both a
  // backend-less deploy and a transient failure, never rejects.
  const counts = useLoaded(() => loadModCounts().then((value) => ({ value })));
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
  const [group, setGroup] = useUrlState("group", groupCodec);
  const [comparator, setComparator] = useUrlState("cmp", comparatorCodec);
  const [threshold, setThreshold] = useUrlState("n", thresholdCodec);
  // Local editing buffer so the field can be freely cleared/retyped — a
  // number input controlled directly by the clamped URL value fights the
  // user mid-edit (e.g. can't clear "1" to type "9"). Commits (clamped to
  // [FREQUENCY_MIN, FREQUENCY_MAX]) on blur/Enter; invalid or empty input
  // reverts to the last committed value.
  const [thresholdInput, setThresholdInput] = useState(String(threshold));
  useEffect(() => setThresholdInput(String(threshold)), [threshold]);
  const commitThreshold = (raw: string) => {
    const n = Number(raw);
    if (!raw || !Number.isFinite(n)) {
      setThresholdInput(String(threshold));
      return;
    }
    const clamped = Math.min(FREQUENCY_MAX, Math.max(FREQUENCY_MIN, Math.round(n)));
    setThreshold(clamped);
    setThresholdInput(String(clamped));
    track("report_filter", { report: "mod-frequency", filter_type: "threshold", value: clamped, active: clamped !== FREQUENCY_DEFAULT });
  };

  // The full, unfiltered atlas — the per-category summary's denominator and
  // the histogram's source, so both reflect each category/bucket's true
  // size, not just the doc-level table's filtered subset.
  const rows = useMemo(
    () => (docs && counts?.value ? buildModFrequencyRows(docs, counts.value, agentByDoc) : null),
    [docs, counts, agentByDoc],
  );
  const matchesFilter = useCallback((count: number) => matchesFrequency(count, comparator, threshold), [comparator, threshold]);
  const summary = useMemo(
    () => (rows ? summarizeModFrequencyMatches(rows, group, (r) => matchesFilter(r.count)) : null),
    [rows, group, matchesFilter],
  );
  const histogram = useMemo(() => (rows ? buildModCountHistogram(rows) : null), [rows]);

  const docRows = useMemo(
    () => (rows ? rows.filter((r) => matchesFilter(r.count)) : null),
    [rows, matchesFilter],
  );

  const isBucketIncluded = useCallback((b: ModCountBucket) => matchesFilter(b.count), [matchesFilter]);

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
  const onComparator = (c: FrequencyComparator) => {
    setComparator(c);
    track("report_filter", { report: "mod-frequency", filter_type: "comparator", value: c, active: c !== "lte" });
  };

  const filterLabel = `${comparator === "lte" ? "≤" : ">"}${threshold} modification${threshold === 1 ? "" : "s"}`;

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
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <CategoryPills
              categories={FREQUENCY_COMPARATORS}
              active={comparator}
              onToggle={onComparator}
              label="Show"
              display={comparatorDisplay(threshold)}
            />
            <label className="flex items-center gap-1.5 text-xs text-tan-3">
              Edits
              <input
                type="number"
                min={FREQUENCY_MIN}
                max={FREQUENCY_MAX}
                value={thresholdInput}
                onChange={(e) => setThresholdInput(e.target.value)}
                onBlur={(e) => commitThreshold(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                className="w-14 px-1.5 py-0.5 rounded border bg-transparent mono text-xs text-tan"
                style={{ borderColor: "var(--border)" }}
              />
            </label>
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
            <ModFrequencySummaryTable summary={summary} matchLabel={filterLabel} />
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
