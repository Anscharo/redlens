import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "../../lib/routes";
import { Highlight } from "./Highlight";
import type { ReportQuery } from "../../lib/reportFilter";
import type { ModFrequencyGroup } from "../../lib/modFrequencyIndex";

// One group's table for the Modification Frequency report. Rows arrive already
// in the report's global least-modified-first order; the Section column drops
// out when the page is grouped by section (the heading carries it).
export function ModFrequencyTable({
  group,
  rq,
  showSection,
}: {
  group: ModFrequencyGroup;
  rq: ReportQuery;
  showSection: boolean;
}) {
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
          {group.rows.map((r) => (
            <tr
              key={r.id}
              className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors"
            >
              <td className="py-2 px-3 align-top">
                <AtlasLink
                  to={atlasHref(r.id)}
                  className="mono text-xs text-accent no-underline hover:underline"
                >
                  <Highlight text={r.docNo} rq={rq} />
                </AtlasLink>
              </td>
              <td className="py-2 px-3 align-top text-sm text-tan">
                <Highlight text={r.title} rq={rq} />
              </td>
              <td className="py-2 px-3 align-top text-xs mono text-tan-2">
                <Highlight text={r.type} rq={rq} />
              </td>
              {showSection && (
                <td className="py-2 px-3 align-top text-xs text-tan-2">
                  <Highlight
                    text={r.sectionTitle === r.section ? r.section : `${r.section} ${r.sectionTitle}`}
                    rq={rq}
                  />
                </td>
              )}
              <td className="py-2 px-3 align-top text-sm mono text-tan text-right">{r.count}</td>
              <td className="py-2 px-3 align-top text-xs mono text-tan-2">
                {r.lastModified ?? "never"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
