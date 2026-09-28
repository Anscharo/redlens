import type { ReactNode } from "react";
import type { CitationMark } from "./api";

type Claim = CitationMark["claims"][number];

// The chip shows two marks and nothing else. A sure document match (✓✓) and a
// confirmed contradiction (!). Weaker folds — a check under the measured
// cliff, a partial, a gap, a change-record match — stay on the stored
// judgement and never reach a reader. A false check and a false warning both
// ask the reader to adjudicate something the measurement does not support.
const SHOWN = new Set<CitationMark["status"]>(["backed", "disputed"]);

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

function contradicted(mark: CitationMark): Claim[] {
  return mark.claims.filter((c) => c.verdict === "contradicts").slice(0, MAX_CLAIMS_SHOWN);
}

function claimLabel(claim: Claim): string {
  return `This source says otherwise: ${quote(claim.claim)}`;
}

function accessibleName(mark: CitationMark): string {
  if (mark.status === "backed") return BACKED_LINE;
  const line = contradicted(mark)[0];
  return line ? claimLabel(line) : "This document says otherwise";
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
  const lines = contradicted(mark);
  if (lines.length === 0) return "This document says otherwise";
  return (
    <>
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
      {mark.status === "backed" ? "✓✓" : "!"}
    </span>
  );
}
