// Shared finding fields for the Potential Mistakes table and the mobile pager.
// The table lays these out as columns; the pager stacks them in a definition
// list so one finding fits a phone without sideways scrolling.
import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "@/lib/routes";
import {
  CATEGORY_LABELS,
  PASS_LABELS,
  STATUS_LABELS,
  type MistakeRow,
} from "@/lib/potentialMistakesIndex";
import type { ReportQuery } from "@/lib/reportFilter";
import { Highlight } from "./Highlight";

export const SEV_TONE: Record<MistakeRow["severity"], string> = {
  high: "var(--error-text)",
  medium: "var(--warn)",
  low: "var(--tan-3)",
};

export function StatusNote({ r }: { r: MistakeRow }) {
  if (r.status === "current") return null;
  const tone = r.status === "missing" ? "var(--error-text)" : "var(--warn)";
  return (
    <span className="mono text-[10px] block mt-0.5" style={{ color: tone }}>
      {STATUS_LABELS[r.status]}
      {r.status === "renumbered" && ` → ${r.currentDocNo}`}
    </span>
  );
}

export function Fix({ r, rq, split }: { r: MistakeRow; rq: ReportQuery; split: boolean }) {
  if (!r.fix) return <p className="mono text-[10px] text-tan-3">needs an author decision</p>;
  return (
    <p className="mono text-[10px] text-tan-3">
      {!split && "suggested: "}
      <Highlight text={r.fix} rq={rq} />
    </p>
  );
}

export function MistakeCard({ r, rq }: { r: MistakeRow; rq: ReportQuery }) {
  return (
    <article className="rounded border border-[var(--border)] px-3 py-3">
      <dl className="flex flex-col gap-3 m-0">
        <div>
          <dt className="mono text-[10px] text-tan-3">Document</dt>
          <dd className="mt-0.5 m-0">
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
          </dd>
        </div>
        <div>
          <dt className="mono text-[10px] text-tan-3">Category</dt>
          <dd className="mt-0.5 m-0">
            <span className="mono text-[10px] block" style={{ color: SEV_TONE[r.severity] }}>
              {r.severity}
            </span>
            <span className="mono text-[10px] text-tan-3 block">{CATEGORY_LABELS[r.category] ?? r.category}</span>
            <span className="mono text-[10px] text-tan-3 block">{PASS_LABELS[r.pass]}</span>
          </dd>
        </div>
        <div>
          <dt className="mono text-[10px] text-tan-3">Quoted Atlas text</dt>
          <dd className="mt-0.5 m-0">
            {r.quote ? (
              <q className="text-xs text-tan-2 italic">
                <Highlight text={r.quote} rq={rq} />
              </q>
            ) : (
              <span className="mono text-[10px] text-tan-3">—</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="mono text-[10px] text-tan-3">What looks wrong</dt>
          <dd className="mt-0.5 m-0">
            <p className="text-xs text-tan-2 m-0">
              <Highlight text={r.issue} rq={rq} />
            </p>
          </dd>
        </div>
        <div>
          <dt className="mono text-[10px] text-tan-3">Suggested</dt>
          <dd className="mt-0.5 m-0">
            <Fix r={r} rq={rq} split />
          </dd>
        </div>
      </dl>
    </article>
  );
}
