import type { ReactNode } from "react";
import type { CitationMark } from "./api";

type Status = CitationMark["status"];
type Claim = CitationMark["claims"][number];

// The glyph each status draws, written here exactly as the reader sees it.
// The check and the warning are rendered as separate spans so each can carry
// its own colour, but this map holds the WHOLE mark so it can be read at a
// glance rather than assembled from two places.
const GLYPH: Record<Status, string> = {
  backed: "✓✓",
  backed_weak: "✓",
  mixed: "✓⚠",
  partial: "✓⚠",
  uncovered: "⚠",
  disputed: "!",
};

// Split out of the glyph above so it can be coloured apart from the check.
const WARN = "⚠";

const CLAIM_CHAR_CAP = 140;
const MAX_CLAIMS_SHOWN = 5;
// Quoted lines a headline can point at. Every quoted line is its own element,
// so each one is a button that scrolls to that sentence in the answer — which
// is why a headline REFERS to a line by letter instead of inlining the quote.
// An inlined quote is a string inside a headline and can never be clicked.
const LETTERS = ["A", "B", "C", "D", "E"];

// A cut mid-word, or mid-clause, changes what the reader thinks was checked.
// Prefer the last sentence end inside the budget, then the last clause break,
// then the last word break — but only when the boundary keeps most of the
// budget, so a quote is never trimmed down to a fragment.
const KEEP_AT_LEAST = 0.6;

function truncateClaim(claim: string, cap = CLAIM_CHAR_CAP): string {
  if (claim.length <= cap) return claim;
  const head = claim.slice(0, cap);
  const floor = Math.floor(cap * KEEP_AT_LEAST);
  const last = (marks: string[]) => Math.max(...marks.map((m) => head.lastIndexOf(m)));
  const sentence = last([". ", "! ", "? "]);
  const clause = last([", ", "; ", ": "]);
  const word = head.lastIndexOf(" ");
  const cut = sentence >= floor ? sentence + 1 : clause >= floor ? clause + 1 : word >= floor ? word : cap - 1;
  return `${claim.slice(0, cut).trimEnd()}…`;
}

const quote = (claim: string) => `“${truncateClaim(claim)}”`;

// The whole confidence vocabulary. There used to be three bands cut at 0.75
// and 0.45, chosen by feel and never measured. There are two now, and the
// STATUS carries them: MIN_BACKED_CONFIDENCE (verify/citation-marks.ts) split
// full support into `backed` and `backed_weak` server-side, so nothing here
// re-reads a number. That threshold was measured on CHECKS — 29 of 30 right
// above it, 16 of 27 below — and the same pass found confidence carries no
// information on a warning, so no warning gets a band.
const SURE = "High confidence";
const UNSURE = "Low confidence";

// Which citing lines a status quotes, in the order its headline refers to
// them. Every one becomes a button that jumps to the sentence in the answer.
function quotedClaims(mark: CitationMark): Claim[] {
  const of = (...verdicts: Claim["verdict"][]) => mark.claims.filter((c) => verdicts.includes(c.verdict));
  switch (mark.status) {
    case "backed":
    case "backed_weak":
      return []; // nothing to look at — the headline says it all
    case "mixed": {
      // The surest supporting line and the weakest, which is exactly what the
      // status means. Sorted so the headline's A and B always line up.
      const sorted = of("supports").sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
      return sorted.length > 1 ? [sorted[0], sorted[sorted.length - 1]] : sorted;
    }
    case "partial":
      // Naming the partly-stated line is what tells the reader which sentence
      // the caveat is about. Without it, a document that fully backs one line
      // and partly backs another reads as a caveat on both.
      return of("supports_in_part").slice(0, MAX_CLAIMS_SHOWN);
    case "uncovered":
      return of("says_nothing").slice(0, MAX_CLAIMS_SHOWN);
    case "disputed":
      return of("contradicts", "says_nothing").slice(0, MAX_CLAIMS_SHOWN);
  }
}

// The headline above the quoted lines. Null where the lines say it better on
// their own — a contradiction and a gap both label themselves.
function summary(mark: CitationMark, quoted: Claim[]): string | null {
  switch (mark.status) {
    case "backed":
      return `${SURE} this source backs the answer`;
    case "backed_weak":
      return `${UNSURE} this source backs the answer`;
    case "mixed":
      return quoted.length > 1
        ? `${SURE} this source supports citation A but ${UNSURE.toLowerCase()} it supports citation B`
        : `${SURE} this source backs the answer`;
    case "partial":
      return quoted.length > 1
        ? "This source states part of each citation below and says nothing about the rest"
        : "This source states part of citation A and says nothing about the rest";
    case "uncovered":
    case "disputed":
      return null;
  }
}

// A line the headline points at by letter, or a line that labels itself.
function claimLabel(claim: Claim, index: number): string {
  switch (claim.verdict) {
    case "contradicts":
      return `This source says otherwise: ${quote(claim.claim)}`;
    case "says_nothing":
      return `Not stated in this source. Please double-check: ${quote(claim.claim)}`;
    default:
      return `${LETTERS[index] ?? "•"}: ${quote(claim.claim)}`;
  }
}

// Stands in for the accessible name when a status has no headline and no line
// survived — defensive only, since both of those statuses require a claim.
const BARE_NAME: Record<Status, string> = {
  backed: "This source backs the answer",
  backed_weak: "This source backs the answer",
  mixed: "This source backs the answer",
  partial: "This source states part of what cites it",
  uncovered: "This source doesn't cover a line citing it",
  disputed: "This source says otherwise",
};

// Content for the shared Tooltip, shown when the whole source pill is hovered.
// Null when this doc was never marked — the pill is just a link then.
// `onShowClaim` turns a quoted line into a control that highlights it above.
export function sourceTooltipContent(
  mark: CitationMark | undefined,
  onShowClaim?: (claim: string) => void,
): ReactNode {
  if (!mark) return null;
  const quoted = quotedClaims(mark);
  const headline = summary(mark, quoted);
  if (quoted.length === 0) return headline ?? BARE_NAME[mark.status];
  return (
    <>
      {headline && <div>{headline}</div>}
      {quoted.map((c, i) => {
        const label = claimLabel(c, i);
        if (!onShowClaim) return <div key={i}>{label}</div>;
        return (
          <button
            key={i}
            type="button"
            className="rlc-cite-jump"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onShowClaim(c.claim)}
          >
            {label}
          </button>
        );
      })}
    </>
  );
}

// The accessible name has to stand alone, so a status with no headline borrows
// its first quoted line.
function accessibleName(mark: CitationMark): string {
  const quoted = quotedClaims(mark);
  return summary(mark, quoted) ?? (quoted[0] ? claimLabel(quoted[0], 0) : BARE_NAME[mark.status]);
}

// Appended to a Sources chip after the title — the glyph only. Hover copy
// lives on the pill (Sources.tsx wraps it in Tooltip); a `title` here would
// be a second, native tooltip on the same hover.
export function SourceMark({ mark }: { mark: CitationMark | undefined }) {
  if (!mark) return null;
  const glyph = GLYPH[mark.status];
  return (
    <span className="rlc-cite-mark" data-status={mark.status} role="img" aria-label={accessibleName(mark)}>
      {glyph.replace(WARN, "")}
      {glyph.includes(WARN) && <span className="rlc-cite-warn">{WARN}</span>}
    </span>
  );
}
