import type { Rating } from "@/lib/oeaAssessment";
import type { OeaRow } from "@/lib/oeaReport";

const RATING_STYLE: Record<Rating, string> = {
  weak: "bg-[color-mix(in_srgb,var(--red)_30%,transparent)] text-tan",
  mid: "bg-[var(--hover)] text-tan-2",
  strong: "bg-[color-mix(in_srgb,var(--terminal-green)_28%,transparent)] text-tan",
};

export function RatingPill({ r }: { r: Rating | null }) {
  if (!r) return <span className="mono text-[10px] text-tan-3">—</span>;
  return <span className={`mono text-[10px] px-1.5 py-0.5 rounded ${RATING_STYLE[r]}`}>{r}</span>;
}

// Precision, incentives and status cells of an assessed task's row.
export function OeaRatingCells({ row }: { row: OeaRow }) {
  const e = row.entry;
  return (
    <>
      <td className="py-2 px-3 align-top"><RatingPill r={e?.precision.rating ?? null} /></td>
      <td className="py-2 px-3 align-top">
        <RatingPill r={e?.incentives.rating ?? null} />
        {e && <span className="text-tan-3 text-[10px] ml-1 cursor-help" title={`assessed by ${e.model}`}>✳</span>}
      </td>
      <td className="py-2 px-3 align-top">
        {row.status !== "fresh" && (
          <span className={`badge ${row.status === "stale" ? "badge-red" : "badge-muted"}`}>{row.status}</span>
        )}
      </td>
    </>
  );
}
