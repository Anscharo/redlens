import type { ReactNode } from "react";
import { flexTokenSource, type HiddenMatch } from "../../lib/reportFilter";

// Wraps every query-token occurrence in `text` in a <mark>. Tokens are matched
// whitespace-flexibly so a de-spaced query ("skybase") still highlights
// "Sky Base". Longest token first so overlapping tokens prefer the long match.
export function Highlight({ text, tokens }: { text: string | null | undefined; tokens: string[] }) {
  if (!text || tokens.length === 0) return <>{text}</>;
  const re = new RegExp(
    [...tokens].sort((a, b) => b.length - a.length).map(flexTokenSource).join("|"),
    "gi",
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
export function MatchAside({ matches, tokens }: { matches: HiddenMatch[]; tokens: string[] }) {
  if (matches.length === 0) return null;
  return (
    <span className="match-aside" aria-label="matched on a field not shown in this row">
      {matches.map((m) => (
        <span key={m.label} className="block">
          <span className="match-aside-label">{m.label}</span>{" "}
          <Highlight text={m.excerpt} tokens={tokens} />
        </span>
      ))}
    </span>
  );
}
