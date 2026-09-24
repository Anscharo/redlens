import type { ReactNode } from "react";
import type { CitationMark } from "./api";

// Per-verdict copy for the mark's accessible name (and, for "backed", its
// hover text too — a short line is enough there). Keep these in sync with
// the CLAUDE.md citation dictate's spirit: the mark reports what the check
// found, never invents a stronger claim than the verdict supports.
const ACCESSIBLE_NAME: Record<CitationMark["status"], string> = {
  backed: "Checked: this source backs the answer",
  unbacked: "This source doesn't cover every line citing it",
  disputed: "This source may say otherwise",
};

const GLYPH: Record<CitationMark["status"], string> = {
  backed: "✓",
  unbacked: "–",
  disputed: "!",
};

const CLAIM_CHAR_CAP = 140;
const MAX_CLAIMS_SHOWN = 5;

function truncateClaim(claim: string): string {
  return claim.length > CLAIM_CHAR_CAP ? `${claim.slice(0, CLAIM_CHAR_CAP - 1)}…` : claim;
}

// "92% confident…" for the ✓ and the !. The muted dash's hover stays which
// line isn't covered; a percent is only on the check and the warning.
function confidenceSentence(mark: CitationMark): string | null {
  if (mark.status !== "backed" && mark.status !== "disputed") return null;
  if (typeof mark.confidence !== "number" || !Number.isFinite(mark.confidence)) return null;
  const pct = Math.round(Math.min(1, Math.max(0, mark.confidence)) * 100);
  return mark.status === "backed"
    ? `${pct}% confident this source backs the answer`
    : `${pct}% confident this source says otherwise`;
}

function claimLines(mark: CitationMark): string[] {
  if (mark.status === "backed") return [];
  return mark.claims
    .filter((c) => c.verdict !== "supports")
    .slice(0, MAX_CLAIMS_SHOWN)
    .map((c) => {
      const prefix = c.verdict === "contradicts" ? "This source says otherwise" : "Not stated in this source";
      return `${prefix}: "${truncateClaim(c.claim)}"`;
    });
}

// Content for the shared Tooltip, shown when the whole source pill is hovered.
// Null when this doc was never marked — the pill is just a link then.
export function sourceTooltipContent(mark: CitationMark | undefined): ReactNode {
  if (!mark) return null;
  const confidence = confidenceSentence(mark);
  const lines = claimLines(mark);
  if (lines.length === 0) return confidence ?? ACCESSIBLE_NAME[mark.status];
  return (
    <>
      {confidence && <div>{confidence}</div>}
      {lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </>
  );
}

function accessibleName(mark: CitationMark): string {
  return confidenceSentence(mark) ?? ACCESSIBLE_NAME[mark.status];
}

// Appended to a Sources chip after the title — the glyph only. Hover copy
// lives on the pill (Sources.tsx wraps it in Tooltip); a `title` here would
// be a second, native tooltip on the same hover.
export function SourceMark({ mark }: { mark: CitationMark | undefined }) {
  if (!mark) return null;
  return (
    <span className="rlc-cite-mark" data-status={mark.status} role="img" aria-label={accessibleName(mark)}>
      {GLYPH[mark.status]}
    </span>
  );
}
