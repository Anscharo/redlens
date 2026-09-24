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

// Display scale on Jev Choice confidence: how peaked the verdict distribution
// is, not the probability of the chosen option and not a chance the line is
// correct. Cuts are for wording only — they are not a calibrated operating point.
const HIGH_CONFIDENCE = 0.75;
const MEDIUM_CONFIDENCE = 0.45;

function truncateClaim(claim: string): string {
  return claim.length > CLAIM_CHAR_CAP ? `${claim.slice(0, CLAIM_CHAR_CAP - 1)}…` : claim;
}

function confidenceWord(confidence: number): "High" | "Medium" | "Low" {
  if (confidence >= HIGH_CONFIDENCE) return "High";
  if (confidence >= MEDIUM_CONFIDENCE) return "Medium";
  return "Low";
}

// "High confidence…" for the ✓ and the !. The muted dash's hover stays which
// line isn't covered; a band is only on the check and the warning.
function confidenceSentence(mark: CitationMark): string | null {
  if (mark.status !== "backed" && mark.status !== "disputed") return null;
  if (typeof mark.confidence !== "number" || !Number.isFinite(mark.confidence)) return null;
  const word = confidenceWord(Math.min(1, Math.max(0, mark.confidence)));
  return mark.status === "backed"
    ? `${word} confidence this source backs the answer`
    : `${word} confidence this source says otherwise`;
}

// Both supporting verdicts are silent. `supports_in_part` means the document
// backs the part it was cited for, which is not a finding to quote.
function isFinding(
  verdict: CitationMark["claims"][number]["verdict"],
): verdict is "says_nothing" | "contradicts" {
  return verdict !== "supports" && verdict !== "supports_in_part";
}

function claimLabel(verdict: "says_nothing" | "contradicts", claim: string): string {
  const prefix = verdict === "contradicts" ? "This source says otherwise" : "Not stated in this source";
  return `${prefix}: "${truncateClaim(claim)}"`;
}

// Content for the shared Tooltip, shown when the whole source pill is hovered.
// Null when this doc was never marked — the pill is just a link then.
// `onShowClaim` turns a quoted line into a control that highlights it above.
export function sourceTooltipContent(
  mark: CitationMark | undefined,
  onShowClaim?: (claim: string) => void,
): ReactNode {
  if (!mark) return null;
  const confidence = confidenceSentence(mark);
  const claims = mark.status === "backed" ? [] : mark.claims.filter((c) => isFinding(c.verdict)).slice(0, MAX_CLAIMS_SHOWN);
  if (claims.length === 0) return confidence ?? ACCESSIBLE_NAME[mark.status];
  return (
    <>
      {confidence && <div>{confidence}</div>}
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
