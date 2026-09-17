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

// Quote / issue / fix wrap instead of widening the table. table-layout:fixed
// plus min-w-0 on those columns means they share leftover space and only grow
// when the window has it — they no longer floor at 50ch each (~48rem together),
// which is what forced a horizontal scrollbar as soon as the table appeared.
// Suggested still waits until 110rem so three prose columns stay readable;
// below that it stays under the explanation.
export const SPLIT_FIX_AT = "(min-width: 110rem)";
// Tailwind `md` is 48rem. Below that a four-column table is unreadable, so the
// pager shows one stacked finding at a time instead.
export const MOBILE_AT = "(max-width: 47.99rem)";
const PROSE = "min-w-0 max-w-[65ch] break-words";
// ReportShell's px-6 gutter is 1.5rem a side. The table must not grow the page
// past that — flex min-width:auto on the app shell otherwise lets wide columns
// push the whole window sideways. overflow-x is a last resort for a pathological
// token, not the normal layout.
const TABLE_MAX = "w-full min-w-0 overflow-x-auto [max-width:calc(100vw-3rem)]";

function headers(split: boolean): [label: string, width: string][] {
  return [
    ["Document", "w-[10rem]"],
    ["Category", "w-[7rem]"],
    ["Quoted Atlas text", "min-w-0"],
    ["What looks wrong", "min-w-0"],
    ...(split ? ([["Suggested", "min-w-0"]] as [string, string][]) : []),
  ];
}

function Row({ r, rq, split }: { r: MistakeRow; rq: ReportQuery; split: boolean }) {
  return (
    <tr className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors">
      <td className="py-2 px-2 align-top relative">
        <MatchAside matches={hiddenMatches(mistakeSearchFields(r), rq)} rq={rq} />
        <div className="min-w-0 break-words">
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
      <td className="py-2 px-2 align-top">
        <div className="min-w-0 break-words">
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
      <td className="py-2 px-2 align-top">
        <div className={PROSE}>
          {r.quote ? (
            <q className="text-xs text-tan-2 italic">
              <Highlight text={r.quote} rq={rq} />
            </q>
          ) : (
            <span className="mono text-[10px] text-tan-3">—</span>
          )}
        </div>
      </td>
      <td className="py-2 px-2 align-top">
        <div className={PROSE}>
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
        <td className="py-2 px-2 align-top">
          <div className={PROSE}>
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
      <table className="w-full table-fixed text-left border-collapse">
        <colgroup>
          <col className="w-[10rem]" />
          <col className="w-[7rem]" />
          <col />
          <col />
          {split && <col />}
        </colgroup>
        <thead>
          <tr className="border-b border-[var(--border)]">
            {headers(split).map(([label, width]) => (
              <th key={label} className={`py-2 px-2 mono text-[10px] text-tan-3 font-normal ${width}`}>
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
