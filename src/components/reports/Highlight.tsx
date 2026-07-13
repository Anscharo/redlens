import type { ReactNode } from "react";
import { flexTokenSource, type HiddenMatch, type ReportQuery } from "../../lib/reportFilter";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Wraps every query-needle occurrence in `text` in a <mark>. Matching mirrors
// the filter: case-insensitive unless the query is strict (rq.cased). Exact
// substring by default; `flex` (for entity-name cells only) also bridges
// internal whitespace so a de-spaced query ("skybase") highlights "Sky Base".
// Never set flex on prose — it would mark junk like "dss" ↔ "recorDS Show".
// Longest needle first so overlapping needles prefer the long match.
export function Highlight({ text, rq, flex = false }: { text: string | null | undefined; rq: ReportQuery; flex?: boolean }) {
  if (!text || rq.needles.length === 0) return <>{text}</>;
  const re = new RegExp(
    [...rq.needles].sort((a, b) => b.length - a.length).map(flex ? flexTokenSource : escapeRe).join("|"),
    rq.cased ? "g" : "gi",
  );
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<mark key={i++} className="q-mark">{m[0]}</mark>);
    last = m.index + m[0].length;
  }
  if (last === 0) return <>{text}</>;
  parts.push(text.slice(last));
  return <>{parts}</>;
}

// Floating note beside a row (left margin, wide screens) explaining a match
// that isn't visible in the row itself: the hidden field's label + a
// highlighted excerpt around the matched term. Anchor the containing cell
// with `relative`.
export function MatchAside({ matches, rq }: { matches: HiddenMatch[]; rq: ReportQuery }) {
  if (matches.length === 0) return null;
  return (
    <span className="match-aside" aria-label="matched on a field not shown in this row">
      {matches.map((m) => (
        <span key={m.label} className="block">
          <span className="match-aside-label">{m.label}</span>{" "}
          <Highlight text={m.excerpt} rq={rq} flex={m.despace} />
        </span>
      ))}
    </span>
  );
}
