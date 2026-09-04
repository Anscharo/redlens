// Provenance disclaimers for reconstructed (non-native) history entries — split out
// of NodeHistory.tsx to keep that file at the 2-live-component convention.

// 7b43d159 is the last commit before the migration (22cc27b5) — the HTML file's
// content right before the switch to markdown.
export const PRE_MD_HTML_URL =
  "https://github.com/sky-ecosystem/next-gen-atlas/blob/7b43d159e098b30e67c4be6a7594a237a340fa58/Sky%20Atlas/Sky%20Atlas.html";

// Tooltip content for a reconstructed (era="html") entry's info icon — the
// lineage across the 79 pre-#117 HTML commits was reconstructed, not native.
export function HtmlEraDisclaimer() {
  return (
    <span className="mono text-[11px] leading-snug">
      This history is reconstructed.{" "}
      <a
        href="/provenance#reconstructed-history"
        className="hover:underline focus-visible:underline"
        style={{ color: "var(--accent)" }}
      >
        Learn how <span className="enlargen">→</span>
      </a>
    </span>
  );
}

// Before the first git snapshot (4e931dfd, 2025-05-28) there is no commit history at
// all — era mip/genesis/severed (docs/plans/pre-git-history.md) are corroborated from
// external sources instead: the pre-2024 MIP-era Atlas, the recovered Atlas v2 genesis
// snapshot, or an undated interval somewhere in the git-less window between them.
export function PreGitDisclaimer() {
  return (
    <span className="mono text-[11px] leading-snug">
      This history comes from pre-git sources.{" "}
      <a
        href="/provenance#pre-git-history"
        className="hover:underline focus-visible:underline"
        style={{ color: "var(--accent)" }}
      >
        Learn more <span className="enlargen">→</span>
      </a>
    </span>
  );
}
