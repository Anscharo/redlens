// Pure, DOM-free string helper: replace markdown links and images with their
// visible text. URL slugs often contain prose-like words ("…-due-to-…") that
// poison text heuristics, so any code matching against atlas prose should strip
// links with this first.
//
// Extracted from atlasHelpers.ts (which type-imports browser-coupled modules
// like docs/glossary/chainstate) so server-side report derivation can import it
// without dragging the DOM into the server tsconfig. atlasHelpers re-exports it,
// so existing frontend callers are unaffected.
export const stripMarkdownLinks = (s: string): string =>
  s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");
