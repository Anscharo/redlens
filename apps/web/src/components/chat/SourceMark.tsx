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
// Two quotes share one sentence in the `mixed` tooltip, so each gets less room.
const INLINE_CLAIM_CAP = 75;
const MAX_CLAIMS_SHOWN = 5;

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

const quote = (claim: string, cap?: number) => `“${truncateClaim(claim, cap)}”`;

// The whole confidence vocabulary. There used to be three bands cut at 0.75
// and 0.45, chosen by feel and never measured. There are two now, and they sit
// on the one threshold the calibration pass actually found
// (MIN_BACKED_CONFIDENCE in verify/citation-marks.ts): at or above it a check
// was right 29 times in 30, below it 16 in 27. Nothing else earns a word.
const SURE = "High confidence";
const UNSURE = "Low confidence";
const SURE_AT = 0.95;

const isSure = (confidence: number | null | undefined) =>
  typeof confidence === "number" && Number.isFinite(confidence) && confidence >= SURE_AT;

// The headline sentence, above any quoted lines. Null where the quoted lines
// say it better on their own.
function summary(mark: CitationMark): string | null {
  switch (mark.status) {
    case "backed":
      return `${SURE} this source backs the answer`;
    case "backed_weak":
      return `${UNSURE} this source backs the answer`;
    case "mixed": {
      const sorted = mark.claims
        .filter((c) => c.verdict === "supports")
        .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
      const sure = sorted[0];
      const unsure = sorted[sorted.length - 1];
      if (!sure || sure === unsure) return `${SURE} this source backs the answer`;
      return `${SURE} this source supports ${quote(sure.claim, INLINE_CLAIM_CAP)} but ${UNSURE.toLowerCase()} it supports ${quote(unsure.claim, INLINE_CLAIM_CAP)}`;
    }
    case "partial":
      return "This document supports part but maybe not all it is being asked to support";
    case "uncovered":
      return null; // every uncovered line is quoted below instead
    case "disputed":
      return `${isSure(mark.confidence) ? SURE : UNSURE} this source says otherwise`;
  }
}

// Which citing lines get quoted under the headline. A supporting line is not a
// finding, and `mixed` already names both of its lines in the headline.
const isFinding = (verdict: Claim["verdict"]): verdict is "says_nothing" | "contradicts" =>
  verdict === "says_nothing" || verdict === "contradicts";

function claimLabel(verdict: "says_nothing" | "contradicts", claim: string): string {
  return verdict === "contradicts"
    ? `This source says otherwise: ${quote(claim)}`
    : `Please double check source: ${quote(claim)}`;
}

// Content for the shared Tooltip, shown when the whole source pill is hovered.
// Null when this doc was never marked — the pill is just a link then.
// `onShowClaim` turns a quoted line into a control that highlights it above.
export function sourceTooltipContent(
  mark: CitationMark | undefined,
  onShowClaim?: (claim: string) => void,
): ReactNode {
  if (!mark) return null;
  const headline = summary(mark);
  const quotable = (c: Claim): c is Claim & { verdict: "says_nothing" | "contradicts" } => isFinding(c.verdict);
  const claims = mark.status === "mixed" ? [] : mark.claims.filter(quotable).slice(0, MAX_CLAIMS_SHOWN);
  if (claims.length === 0) return headline;
  return (
    <>
      {headline && <div>{headline}</div>}
      {claims.map((c, i) => {
        const label = claimLabel(c.verdict, c.claim);
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

// The accessible name has to stand alone, so an `uncovered` mark — which has
// no headline — borrows its first quoted line.
function accessibleName(mark: CitationMark): string {
  const headline = summary(mark);
  if (headline) return headline;
  const first = mark.claims.find((c): c is Claim & { verdict: "says_nothing" | "contradicts" } => isFinding(c.verdict));
  return first ? claimLabel(first.verdict, first.claim) : "This source was checked";
}

// Appended to a Sources chip after the title — the glyph only. Hover copy
// lives on the pill (Sources.tsx wraps it in Tooltip); a `title` here would
// be a second, native tooltip on the same hover.
export function SourceMark({ mark }: { mark: CitationMark | undefined }) {
  if (!mark) return null;
  const glyph = GLYPH[mark.status];
  const check = glyph.replace(WARN, "");
  return (
    <span className="rlc-cite-mark" data-status={mark.status} role="img" aria-label={accessibleName(mark)}>
      {check}
      {glyph.includes(WARN) && <span className="rlc-cite-warn">{WARN}</span>}
    </span>
  );
}
