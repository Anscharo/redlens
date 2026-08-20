import type { WordSegment } from "@/lib/history";

const WORD_ADDED_STYLE: React.CSSProperties = {
  background: "var(--diff-added-bg)",
  color: "var(--diff-added-fg)",
  borderRadius: 2,
};
const WORD_REMOVED_STYLE: React.CSSProperties = {
  background: "var(--diff-removed-bg)",
  color: "var(--diff-removed-fg)",
  borderRadius: 2,
  textDecoration: "line-through",
};

/** The word/sentence-level segments of one modified line. `className` carries
 *  the caller's prose-vs-structured wrapping decision (see DiffView). */
export function IntralineDiff({ segments, className }: { segments: WordSegment[]; className: string }) {
  return (
    <span className={className}>
      {segments.map((seg, i) => {
        const [op, text] = seg;
        if (op === "+")
          return (
            <ins key={i} className="no-underline" style={WORD_ADDED_STYLE}>
              {text}
            </ins>
          );
        if (op === "-")
          return (
            <del key={i} style={WORD_REMOVED_STYLE}>
              {text}
            </del>
          );
        return (
          <span key={i} style={{ color: "var(--tan-2)" }}>
            {text}
          </span>
        );
      })}
    </span>
  );
}
