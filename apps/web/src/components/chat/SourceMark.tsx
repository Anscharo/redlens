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

// Native `title` tooltip text. For unbacked/disputed this lists every
// non-"supports" claim so hovering explains exactly what the check found;
// for backed the accessible name itself is enough. A ✓ or ! with a confidence
// leads with that sentence.
function tooltipText(mark: CitationMark): string {
  const confidence = confidenceSentence(mark);
  if (mark.status === "backed") return confidence ?? ACCESSIBLE_NAME.backed;
  const lines = mark.claims
    .filter((c) => c.verdict !== "supports")
    .slice(0, MAX_CLAIMS_SHOWN)
    .map((c) => {
      const prefix = c.verdict === "contradicts" ? "This source says otherwise" : "Not stated in this source";
      return `${prefix}: "${truncateClaim(c.claim)}"`;
    });
  const detail = lines.length > 0 ? lines.join("\n") : ACCESSIBLE_NAME[mark.status];
  return confidence ? `${confidence}\n${detail}` : detail;
}

function accessibleName(mark: CitationMark): string {
  return confidenceSentence(mark) ?? ACCESSIBLE_NAME[mark.status];
}

// Appended to a Sources chip after the title — reports the post-answer
// citation check's verdict for that doc. `role="img"` + `aria-label` exposes
// the glyph's meaning to assistive tech (the glyph itself carries no
// semantics); `title` gives sighted hover/focus users the per-claim detail.
// Purely presentational/controlled — no data fetching, no local state.
export function SourceMark({ mark }: { mark: CitationMark | undefined }) {
  if (!mark) return null;
  return (
    <span
      className="rlc-cite-mark"
      data-status={mark.status}
      role="img"
      aria-label={accessibleName(mark)}
      title={tooltipText(mark)}
    >
      {GLYPH[mark.status]}
    </span>
  );
}
