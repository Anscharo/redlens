import type { ReactNode } from "react";
import type { CitationMark } from "./api";

type Claim = CitationMark["claims"][number];

// The four marks a chip can draw. Mirrors SHOWN_STATUS in
// verify/citation-marks.ts, which already filters before the wire — this is
// the guard for a stored row folded under an older rule. Keep the two in step.
//
// What stays hidden is the weak-CONFIDENCE group (`backed_weak`, `mixed`,
// `partial`): a check under the measured cliff was right 16 of 27 times, so
// drawing one asserts a sureness the measurement does not support. `unread`
// and `uncovered` are categorical findings rather than weak numbers, so they
// are drawn — hiding them would make the harness silent about what it knows.
const SHOWN = new Set<CitationMark["status"]>(["backed", "disputed", "unread", "uncovered"]);

const GLYPH: Record<string, string> = { backed: "✓✓", disputed: "!", unread: "⚠", uncovered: "⚠" };

const CLAIM_CHAR_CAP = 140;
const MAX_CLAIMS_SHOWN = 5;
const KEEP_AT_LEAST = 0.6;

// What a ✓✓ asserts. The check asked whether this document states the lines
// that cite it — not whether the answer, taken as a whole, is right.
const BACKED_LINE = "High confidence this document states the lines that cite it";

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

function shown(mark: CitationMark | undefined): mark is CitationMark {
  return !!mark && SHOWN.has(mark.status);
}

// The citing lines each status quotes. A supporting line is never quoted —
// the ✓✓ already says it, and there is nothing for the reader to adjudicate.
const QUOTED: Record<string, Claim["verdict"]> = {
  disputed: "contradicts",
  uncovered: "says_nothing",
  unread: "states_content",
};

function quotedLines(mark: CitationMark): Claim[] {
  const want = QUOTED[mark.status];
  return want ? mark.claims.filter((c) => c.verdict === want).slice(0, MAX_CLAIMS_SHOWN) : [];
}

function claimLabel(claim: Claim): string {
  switch (claim.verdict) {
    case "contradicts":
      return `This document says otherwise: ${quote(claim.claim)}`;
    case "states_content":
      return `States what the document says: ${quote(claim.claim)}`;
    default:
      return `Not stated in this document. Please double-check: ${quote(claim.claim)}`;
  }
}

// Stands in when a status has no quoted line left — defensive only, since
// each of the three requires the claim that produced it.
const BARE: Record<string, string> = {
  disputed: "This document says otherwise",
  uncovered: "This document doesn't cover a line citing it",
  unread: "Only a record about this document was read, not the document",
};

function accessibleName(mark: CitationMark): string {
  if (mark.status === "backed") return BACKED_LINE;
  const line = quotedLines(mark)[0];
  return line ? claimLabel(line) : BARE[mark.status];
}

// Content for the shared Tooltip, shown when the whole source pill is hovered.
// Null when this doc has no mark a reader is allowed to see — the pill is
// just a link then. `onShowClaim` turns a contradicted line into a control
// that highlights it above.
export function sourceTooltipContent(
  mark: CitationMark | undefined,
  onShowClaim?: (claim: string) => void,
): ReactNode {
  if (!shown(mark)) return null;
  if (mark.status === "backed") return BACKED_LINE;
  const lines = quotedLines(mark);
  if (lines.length === 0) return BARE[mark.status];
  const headline = mark.status === "unread" ? "Only a change record was read, not the document" : null;
  return (
    <>
      {headline && <div>{headline}</div>}
      {lines.map((c, i) => {
        const label = claimLabel(c);
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

// Appended to a Sources chip after the title — the glyph only. Hover copy
// lives on the pill (Sources.tsx wraps it in Tooltip); a `title` here would
// be a second, native tooltip on the same hover.
export function SourceMark({ mark }: { mark: CitationMark | undefined }) {
  if (!shown(mark)) return null;
  return (
    <span className="rlc-cite-mark" data-status={mark.status} role="img" aria-label={accessibleName(mark)}>
      {GLYPH[mark.status]}
    </span>
  );
}
