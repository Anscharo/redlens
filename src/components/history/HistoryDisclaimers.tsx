// Provenance disclaimers for reconstructed (non-native) history entries — split out
// of NodeHistory.tsx to keep that file at the 2-live-component convention.

// 7b43d159 is the last commit before the migration (22cc27b5) — the HTML file's
// content right before the switch to markdown.
export const PRE_MD_HTML_URL =
  "https://github.com/sky-ecosystem/next-gen-atlas/blob/7b43d159e098b30e67c4be6a7594a237a340fa58/Sky%20Atlas/Sky%20Atlas.html";

// Names the methods used to trace each document's lineage across the 79 pre-#117
// HTML commits (era="html").
export function HtmlEraDisclaimer() {
  return (
    <div
      className="mono text-[10px] px-2 py-2.5 leading-snug my-1"
      style={{ color: "var(--tan-3)", border: "2px solid var(--border)" }}
    >
      <strong style={{ color: "var(--tan-2)" }}>Pre-#117 history is reconstructed.</strong>{" "}
      Before the “Migrate To Markdown File” PR (Nov 2025) the Atlas was a single HTML file
      with no per-document identities. The entries below were automatically translated from
      the original HTML tables to markdown, and each document’s lineage was traced by{" "}
      <span style={{ color: "var(--tan-2)" }}>deterministic matching</span> (content + structure
      fingerprints),{" "}
      <span style={{ color: "var(--tan-2)" }}>AI cross-checks</span> using multiple AI models
      forward and backward looking of changes, PR descriptions for each change, and{" "}
      <span style={{ color: "var(--tan-2)" }}>human review</span> on top; although thorough the
      possibility for mistakes exists.{" "}
      <a
        href={PRE_MD_HTML_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:underline focus-visible:underline"
        style={{ color: "var(--accent)" }}
      >
        view original HTML →
      </a>
    </div>
  );
}

// Before the first git snapshot (4e931dfd, 2025-05-28) there is no commit history at
// all — era mip/genesis/severed (docs/plans/pre-git-history.md) are corroborated from
// external sources instead: the pre-2024 MIP-era Atlas, the recovered Atlas v2 genesis
// snapshot, or an undated interval somewhere in the git-less window between them.
export function PreGitDisclaimer() {
  return (
    <div
      className="mono text-[10px] px-2 py-2.5 leading-snug mt-3 mb-1"
      style={{ color: "var(--tan-3)", border: "2px solid var(--border)" }}
    >
      The history events below trace atlas history prior to the current git repo. While
      we can confidently say which docs were unchanged since genesis or MIPS, for edits in this
      era we dont have the changelogs. Try searching sky forum posts for historical context.
    </div>
  );
}
