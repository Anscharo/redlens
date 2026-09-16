// Table body for the Potential Mistakes report — split out of
// PotentialMistakesReport.tsx so the page file stays data + filters + shell.
import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "@/lib/routes";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { CATEGORY_LABELS, PASS_LABELS, mistakeSearchFields, type MistakeRow } from "@/lib/potentialMistakesIndex";
import { hiddenMatches, type ReportQuery } from "@/lib/reportFilter";
import { Highlight, MatchAside } from "./Highlight";
import { Fix, SEV_TONE, StatusNote } from "./MistakeCard";
import { PotentialMistakesPager } from "./PotentialMistakesPager";

// Prose stops being readable somewhere past ~65ch, so the quote, the
// explanation and the suggested fix are each capped there. The fix only earns a
// column of its own once all three can still hold 50ch; below that it stays
// tucked under the explanation, which is better than three starved ribbons.
//
// 3×50ch + Document 18.75 + Category 9.375 + cell padding 7.5 + page gutter 3
// ≈ 110rem at the table's 12px type (measured 7.6px/ch on the fallback face —
// Inter is narrower, so this errs toward keeping the fix stacked). Every width
// here is rem or ch rather than px so the whole table scales together when a
// reader enlarges their base font: a px breakpoint against ch columns would
// split into three columns that no longer fit 50ch each.
export const SPLIT_FIX_AT = "(min-width: 110rem)";
// Tailwind `md` is 48rem. Below that a four-column table is unreadable, so the
// pager shows one stacked finding at a time instead.
export const MOBILE_AT = "(max-width: 47.99rem)";
const PROSE = "max-w-[65ch]";
const PROSE_SPLIT = "max-w-[65ch] min-w-[50ch]";
// ReportShell's px-6 gutter is 1.5rem a side. The table must not grow the page
// past that — flex min-width:auto on the app shell otherwise lets wide columns
// push the whole window sideways.
const TABLE_MAX = "w-full min-w-0 overflow-x-auto [max-width:calc(100vw-3rem)]";

function headers(split: boolean): [label: string, width: string][] {
  const prose = split ? PROSE_SPLIT : PROSE;
  return [
    ["Document", "min-w-56 max-w-[18.75rem]"],
    ["Category", "min-w-36 max-w-[9.375rem]"],
    ["Quoted Atlas text", prose],
    ["What looks wrong", prose],
    ...(split ? ([["Suggested", prose]] as [string, string][]) : []),
  ];
}

function Row({ r, rq, split }: { r: MistakeRow; rq: ReportQuery; split: boolean }) {
  const prose = split ? PROSE_SPLIT : PROSE;
  return (
    <tr className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors">
      <td className="py-2 px-3 align-top relative">
        <MatchAside matches={hiddenMatches(mistakeSearchFields(r), rq)} rq={rq} />
        <div className="max-w-[18.75rem]">
          {r.uuid ? (
            <AtlasLink to={atlasHref(r.uuid)} className="text-sm text-tan hover:underline text-left block">
              <Highlight text={r.title || r.docNo} rq={rq} />
            </AtlasLink>
          ) : (
            <span className="text-sm text-tan-2">Corpus-wide</span>
          )}
          <span className="mono text-[10px] text-accent block">
            <Highlight text={r.docNo} rq={rq} />
          </span>
          <StatusNote r={r} />
        </div>
      </td>
      <td className="py-2 px-3 align-top">
        <div className="max-w-[9.375rem]">
          <span className="mono text-[10px] block" style={{ color: SEV_TONE[r.severity] }}>
            {r.severity}
          </span>
          <span className="mono text-[10px] text-tan-3 block">
            {CATEGORY_LABELS[r.category] ?? r.category}
          </span>
          <span className="mono text-[10px] text-tan-3 block" title="Which sweep pass reported this">
            {PASS_LABELS[r.pass]}
          </span>
        </div>
      </td>
      <td className="py-2 px-3 align-top">
        <div className={prose}>
          {r.quote ? (
            <q className="text-xs text-tan-2 italic">
              <Highlight text={r.quote} rq={rq} />
            </q>
          ) : (
            <span className="mono text-[10px] text-tan-3">—</span>
          )}
        </div>
      </td>
      <td className="py-2 px-3 align-top">
        <div className={prose}>
          <p className="text-xs text-tan-2">
            <Highlight text={r.issue} rq={rq} />
          </p>
          {!split && (
            <div className="mt-1">
              <Fix r={r} rq={rq} split={split} />
            </div>
          )}
        </div>
      </td>
      {split && (
        <td className="py-2 px-3 align-top">
          <div className={prose}>
            <Fix r={r} rq={rq} split={split} />
          </div>
        </td>
      )}
    </tr>
  );
}

export function PotentialMistakesTable({ rows, rq }: { rows: readonly MistakeRow[]; rq: ReportQuery }) {
  const mobile = useMediaQuery(MOBILE_AT);
  const split = useMediaQuery(SPLIT_FIX_AT);
  if (!rows.length) return null;
  if (mobile) return <PotentialMistakesPager rows={rows} rq={rq} />;
  return (
    <div className={TABLE_MAX}>
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-[var(--border)]">
            {headers(split).map(([label, width]) => (
              <th key={label} className={`py-2 px-3 mono text-[10px] text-tan-3 font-normal ${width}`}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Row key={r.id} r={r} rq={rq} split={split} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
