import { memo } from "react";
import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "@/lib/routes";
import { usePagedRows } from "../../hooks/usePagedRows";
import { Highlight } from "./Highlight";
import type { ReportQuery } from "@/lib/reportFilter";
import type { ModFrequencyGroup, ModFrequencyRow } from "../../lib/modFrequencyIndex";

// One row, memoized so a paging/highlight change elsewhere in the table
// doesn't re-render every already-visible row — only ones whose own props
// (row identity, rq, or showSection) actually changed. `row` objects keep a
// stable identity across re-sorts/re-groups (buildModFrequencyRows builds them
// once; filtering/grouping only reorders references), so this pays off most
// visibly on "Show more": the newly revealed rows mount, the rest don't re-render.
const FrequencyRow = memo(function FrequencyRow({
  row,
  rq,
  showSection,
}: {
  row: ModFrequencyRow;
  rq: ReportQuery;
  showSection: boolean;
}) {
  return (
    <tr className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors">
      <td className="py-2 px-3 align-top">
        <AtlasLink to={atlasHref(row.id)} className="mono text-xs text-accent no-underline hover:underline">
          <Highlight text={row.docNo} rq={rq} />
        </AtlasLink>
      </td>
      <td className="py-2 px-3 align-top text-sm text-tan">
        <Highlight text={row.title} rq={rq} />
      </td>
      <td className="py-2 px-3 align-top text-xs mono text-tan-2">
        <Highlight text={row.type} rq={rq} />
      </td>
      {showSection && (
        <td className="py-2 px-3 align-top text-xs text-tan-2">
          <Highlight
            text={row.sectionTitle === row.section ? row.section : `${row.section} ${row.sectionTitle}`}
            rq={rq}
          />
        </td>
      )}
      <td className="py-2 px-3 align-top text-sm mono text-tan text-right">{row.count}</td>
      <td className="py-2 px-3 align-top text-xs mono text-tan-2">{row.lastModified ?? "never"}</td>
    </tr>
  );
});

// One group's table for the Modification Frequency report. Rows arrive already
// in the report's global least-modified-first order; the Section column drops
// out when the page is grouped by section (the heading carries it). A large
// group (e.g. the flat/type groupings can each hold the whole atlas) is paged
// via usePagedRows rather than mounting thousands of rows at once.
export const ModFrequencyTable = memo(function ModFrequencyTable({
  group,
  rq,
  showSection,
}: {
  group: ModFrequencyGroup;
  rq: ReportQuery;
  showSection: boolean;
}) {
  const { visible, remaining, showMore } = usePagedRows(group.rows);
  return (
    <section className="mb-8">
      <h2 className="text-xs mono text-tan-3 uppercase tracking-wider mb-3 pb-1 border-b border-[var(--border)]">
        {group.label} <span className="text-tan-3/60">({group.rows.length})</span>
      </h2>
      <table className="w-full text-left">
        <thead>
          <tr className="text-xs mono text-tan-3">
            <th className="py-1 px-3 font-normal w-36">Doc</th>
            <th className="py-1 px-3 font-normal">Title</th>
            <th className="py-1 px-3 font-normal w-36">Type</th>
            {showSection && <th className="py-1 px-3 font-normal w-44">Section</th>}
            <th className="py-1 px-3 font-normal w-16 text-right">Edits</th>
            <th className="py-1 px-3 font-normal w-28">Last Modified</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <FrequencyRow key={row.id} row={row} rq={rq} showSection={showSection} />
          ))}
        </tbody>
      </table>
      {remaining > 0 && (
        <button type="button" onClick={showMore} className="mono text-xs text-accent hover:underline mt-2">
          Show {Math.min(remaining, 100)} more ({remaining} remaining)
        </button>
      )}
    </section>
  );
});
