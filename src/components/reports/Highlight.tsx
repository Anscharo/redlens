import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flexTokenSource, type HiddenMatch, type ReportQuery } from "../../lib/reportFilter";
import { fitAsideMatches } from "./asideFit";

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
// with `relative`. Content is height-fitted to the row via pretext text
// measurement (asideFit.ts) so a tall note never overflows into the next
// row's aside.
export function MatchAside({ matches, rq }: { matches: HiddenMatch[]; rq: ReportQuery }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [fitted, setFitted] = useState<HiddenMatch[]>([]);
  // Key of the inputs — the parent recomputes `matches` every render, so the
  // effect must depend on content, not array identity.
  const key = matches.map((m) => `${m.label}\x1f${m.excerpt}`).join("\x1e");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || matches.length === 0) return;
    // The anchoring cell (offsetParent) spans the row's full height in both
    // table rows and the relative list items StaleDates uses.
    const anchor = el.offsetParent as HTMLElement | null;
    const compute = () => {
      const width = el.getBoundingClientRect().width;
      const rowH = anchor?.getBoundingClientRect().height ?? 0;
      setFitted(width > 0 ? fitAsideMatches(matches, width, rowH) : matches);
    };
    compute();
    const ro = anchor ? new ResizeObserver(compute) : null;
    if (anchor) ro!.observe(anchor);
    // Source Code Pro loads async; measurements before that used a fallback.
    document.fonts?.ready.then(compute).catch(() => {});
    return () => ro?.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (matches.length === 0) return null;
  return (
    <span ref={ref} className="match-aside" aria-label="matched on a field not shown in this row">
      {fitted.map((m) => (
        <span key={m.label} className="block">
          <span className="match-aside-label">{m.label}</span>{" "}
          <Highlight text={m.excerpt} rq={rq} flex={m.despace} />
        </span>
      ))}
    </span>
  );
}
