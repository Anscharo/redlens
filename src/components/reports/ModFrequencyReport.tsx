import { useEffect, useMemo, useRef } from "react";
import { useLoaded } from "../../hooks/useAtlasData";
import { loadDocs } from "../../lib/docs";
import { loadModCounts } from "../../lib/history";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { useUrlState, urlEnum } from "../../hooks/useUrlState";
import { track } from "../../lib/analytics";
import { filterRows, parseReportQuery, type ReportMode } from "../../lib/reportFilter";
import {
  buildModFrequencyRows,
  groupModFrequencyRows,
  modFrequencyRowsToCSV,
  modFrequencySearchFields,
  GROUPINGS,
  type ModFrequencyGrouping,
} from "../../lib/modFrequencyIndex";
import { CategoryPills } from "./CategoryPills";
import { FilterSummary } from "./FilterSummary";
import { NoRowsMatch } from "./NoRowsMatch";
import { DownloadCsvButton } from "./DownloadCsvButton";
import { ModFrequencyTable } from "./ModFrequencyTable";

const groupCodec = urlEnum<ModFrequencyGrouping>("section", GROUPINGS);
const GROUP_DISPLAY: Record<ModFrequencyGrouping, string> = {
  section: "section",
  type: "doc type",
  none: "flat list",
};

export function ModFrequencyReport({ query, mode }: { query: string; mode: ReportMode }) {
  useDocumentTitle("Modification Frequency: Sky Atlas by Redline");
  const docs = useLoaded(loadDocs);
  // Wrapped so "still loading" (null) is distinguishable from "no history DB
  // on this deploy" ({ value: null }) — loadModCounts resolves null for both a
  // backend-less deploy and a transient failure, never rejects.
  const counts = useLoaded(() => loadModCounts().then((value) => ({ value })));
  const [group, setGroup] = useUrlState("group", groupCodec);

  const rows = useMemo(
    () => (docs && counts?.value ? buildModFrequencyRows(docs, counts.value) : null),
    [docs, counts],
  );

  const trackedView = useRef(false);
  useEffect(() => {
    if (!rows || trackedView.current) return;
    trackedView.current = true;
    track("report_view", { report: "mod-frequency", row_count: rows.length });
  }, [rows]);

  const rq = useMemo(() => parseReportQuery(query, mode), [query, mode]);
  const filtered = useMemo(
    () => (rows ? filterRows(rows, rq, modFrequencySearchFields) : null),
    [rows, rq],
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
          Every atlas document ranked by how rarely its content has been edited — least modified
          first. Only semantic content edits count: moves, renumbers, renames, and
          formatting/typo cleanups don't. Counts span the atlas's full recorded history,
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
        <FilterSummary query={query} searches="doc no, title, type, section" />
        {rows && filtered && (
          <div className="flex items-center justify-between mb-4">
            <p className="mono text-xs text-tan-3">
              {filtered.length === rows.length
                ? `${rows.length} documents`
                : `${filtered.length} of ${rows.length} documents`}
            </p>
            <DownloadCsvButton
              report="mod-frequency"
              filename="modification-frequency.csv"
              rowCount={filtered.length}
              build={() => modFrequencyRowsToCSV(filtered)}
              fullRowCount={rows.length}
              buildFull={() => modFrequencyRowsToCSV(rows)}
              query={query}
            />
          </div>
        )}
        {counts && counts.value === null ? (
          <p className="text-sm mono" style={{ color: "var(--warn)" }}>
            Modification counts come from the history database, which isn't reachable on this
            deploy. Try again later.
          </p>
        ) : !rows || !groups ? (
          <p className="mono text-base text-tan-3">loading…</p>
        ) : filtered && filtered.length === 0 ? (
          <NoRowsMatch query={query} />
        ) : (
          groups.map((g) => (
            <ModFrequencyTable key={g.key} group={g} rq={rq} showSection={group !== "section"} />
          ))
        )}
      </div>
    </div>
  );
}
