// Table body for the Potential Mistakes report — split out of
// PotentialMistakesReport.tsx so the page file stays data + filters + shell.
import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "@/lib/routes";
import {
  CATEGORY_LABELS,
  PASS_LABELS,
  STATUS_LABELS,
  mistakeSearchFields,
  type MistakeRow,
} from "@/lib/potentialMistakesIndex";
import { hiddenMatches, type ReportQuery } from "@/lib/reportFilter";
import { Highlight, MatchAside } from "./Highlight";

const HEADERS: [label: string, width: string][] = [
  ["Document", "w-56"],
  ["Category", "w-36"],
  ["Quoted Atlas text", ""],
  ["What looks wrong", ""],
];

const SEV_TONE: Record<MistakeRow["severity"], string> = {
  high: "var(--error-text)",
  medium: "var(--warn)",
  low: "var(--tan-3)",
};

// A row whose document moved or vanished since the sweep is the one case where
// the stored doc_no is actively misleading, so it is called out inline rather
// than only in the filter pills.
function StatusNote({ r }: { r: MistakeRow }) {
  if (r.status === "current") return null;
  const tone = r.status === "missing" ? "var(--error-text)" : "var(--warn)";
  return (
    <span className="mono text-[10px] block mt-0.5" style={{ color: tone }}>
      {STATUS_LABELS[r.status]}
      {r.status === "renumbered" && ` → ${r.currentDocNo}`}
    </span>
  );
}

function Row({ r, rq }: { r: MistakeRow; rq: ReportQuery }) {
  return (
    <tr className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors">
      <td className="py-2 px-3 align-top relative">
        <MatchAside matches={hiddenMatches(mistakeSearchFields(r), rq)} rq={rq} />
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
      </td>
      <td className="py-2 px-3 align-top">
        <span className="mono text-[10px] block" style={{ color: SEV_TONE[r.severity] }}>
          {r.severity}
        </span>
        <span className="mono text-[10px] text-tan-3 block">{CATEGORY_LABELS[r.category] ?? r.category}</span>
        <span className="mono text-[10px] text-tan-3 block" title="Which sweep pass reported this">
          {PASS_LABELS[r.pass]}
        </span>
      </td>
      <td className="py-2 px-3 align-top">
        {r.quote ? (
          <q className="text-xs text-tan-2 italic">
            <Highlight text={r.quote} rq={rq} />
          </q>
        ) : (
          <span className="mono text-[10px] text-tan-3">—</span>
        )}
      </td>
      <td className="py-2 px-3 align-top">
        <p className="text-xs text-tan-2">
          <Highlight text={r.issue} rq={rq} />
        </p>
        {r.fix ? (
          <p className="mono text-[10px] text-tan-3 mt-1">
            suggested: <Highlight text={r.fix} rq={rq} />
          </p>
        ) : (
          <p className="mono text-[10px] text-tan-3 mt-1">needs an author decision</p>
        )}
      </td>
    </tr>
  );
}

export function PotentialMistakesTable({ rows, rq }: { rows: readonly MistakeRow[]; rq: ReportQuery }) {
  if (!rows.length) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-[var(--border)]">
            {HEADERS.map(([label, width]) => (
              <th key={label} className={`py-2 px-3 mono text-[10px] text-tan-3 font-normal ${width}`}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Row key={r.id} r={r} rq={rq} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
