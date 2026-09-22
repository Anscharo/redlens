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

// Native `title` tooltip text. For unbacked/disputed this lists every
// non-"supports" claim so hovering explains exactly what the check found;
// for backed the accessible name itself is enough.
function tooltipText(mark: CitationMark): string {
  if (mark.status === "backed") return ACCESSIBLE_NAME.backed;
  const lines = mark.claims
    .filter((c) => c.verdict !== "supports")
    .slice(0, MAX_CLAIMS_SHOWN)
    .map((c) => {
      const prefix = c.verdict === "contradicts" ? "This source says otherwise" : "Not stated in this source";
      return `${prefix}: "${truncateClaim(c.claim)}"`;
    });
  return lines.length > 0 ? lines.join("\n") : ACCESSIBLE_NAME[mark.status];
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
      aria-label={ACCESSIBLE_NAME[mark.status]}
      title={tooltipText(mark)}
    >
      {GLYPH[mark.status]}
    </span>
  );
}
