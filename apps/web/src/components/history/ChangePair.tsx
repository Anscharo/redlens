import { useMemo, type ReactNode } from "react";
import { docNoDiff, type DocNoSegment } from "../../lib/docNoDiff";
import { WORD_ADDED_STYLE, WORD_REMOVED_STYLE } from "./IntralineDiff";

// The two sides sit apart, either side of an arrow, so the removed side needs
// no strike-through to read as the old one; struck digits are hard to read.
const OLD_STYLE: React.CSSProperties = { ...WORD_REMOVED_STYLE, textDecoration: "none", padding: "0 1px" };
const NEW_STYLE: React.CSSProperties = { ...WORD_ADDED_STYLE, padding: "0 1px" };

/** `old → new`. */
function pair(prev: ReactNode, next: ReactNode): ReactNode {
  return (
    <>
      {prev} <span className="enlargen">→</span> {next}
    </>
  );
}

/** One side of a doc number, its changed segments marked with `Mark`. */
function segments(side: DocNoSegment[], Mark: "del" | "ins"): ReactNode {
  const style = Mark === "del" ? OLD_STYLE : NEW_STYLE;
  return side.map((s, i) => (
    <span key={i}>
      {i > 0 && "."}
      {s.changed ? <Mark className="no-underline" style={style}>{s.text}</Mark> : s.text}
    </span>
  ));
}

/** A renumbering, `A.1.2.3 → A.1.4.3`, with the segments that changed
 *  highlighted on each side: removed colour on the old number, added on the new. */
export function DocNoDiff({ prev, next }: { prev: string; next: string }) {
  const d = useMemo(() => docNoDiff(prev, next), [prev, next]);
  return <span className="mono">{pair(<span>{segments(d.prev, "del")}</span>, <span>{segments(d.next, "ins")}</span>)}</span>;
}

/** A `[Type]` change, `[Core] → [Section]`, each type name highlighted. */
export function TypeDiff({ prev, next }: { prev: string; next: string }) {
  return (
    <span className="mono">
      {pair(
        <span>[<del className="no-underline" style={OLD_STYLE}>{prev}</del>]</span>,
        <span>[<ins className="no-underline" style={NEW_STYLE}>{next}</ins>]</span>,
      )}
    </span>
  );
}
