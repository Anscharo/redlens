// Display-only citation repair for the answer renderer (AtlasMarkdown). The
// scan that counts citations is src/lib/citationScan.ts.

import { normalizeLabel, parseDefinitions } from "@/lib/citationScan";

export { DEFINITION_RE, normalizeLabel, parseDefinitions } from "@/lib/citationScan";

// A code span whose entire content is one citation. Models routinely wrap a
// citation in backticks when the link text *looks* like code — an on-chain
// address, a reward code, a numeric id — and CommonMark parses the code span
// first, so the link never renders (it shows as literal `[128](/atlas/…)`
// markup, in monospace). Backticks are excluded from the inner brackets so two
// code spans on one line can't bridge into one false match; the surrounding
// backtick guards keep multi-backtick spans (``…``) out.
const CODE_CITATION_RE =
  /(^|[^`])`(\[[^\]\n`]+\](?:\(\/atlas\/[0-9a-f-]{36}\)|\[[^\]\n`]+\])?)`(?!`)/gi;
const INNER_RE = /^\[([^\]\n`]+)\](\(\/atlas\/[0-9a-f-]{36}\)|\[[^\]\n`]+\])?$/i;
const FENCE_SPLIT_RE = /(```[\s\S]*?```)/g;

/**
 * Display-only repair: move the backticks *inside* the link text of a
 * fully-backticked citation, so it renders as a link whose text is still
 * monospace — `[128](/atlas/<uuid>)` becomes [`128`](/atlas/<uuid>).
 *
 * Applies to inline (`(/atlas/<uuid>)`) and full reference (`[label]`) forms,
 * and to the bare shortcut form only when the label actually resolves in the
 * definition block — an undefined `[0]` inside backticks is code, not a
 * citation. Content inside fenced code blocks is left alone.
 *
 * extractSources deliberately does NOT run this: its scan already matches
 * straight through backticks, and with a clean (un-backticked) title.
 */
export function unwrapCodeCitations(content: string): string {
  const definitions = parseDefinitions(content);
  return content
    .split(FENCE_SPLIT_RE)
    .map((part, i) => (i % 2 === 1 ? part : unwrapPart(part, definitions)))
    .join("");
}

function unwrapPart(text: string, definitions: Map<string, string>): string {
  return text.replace(CODE_CITATION_RE, (match, before: string, inner: string) => {
    const m = INNER_RE.exec(inner);
    if (!m) return match;
    const [, linkText, target] = m;
    // Bare bracket: only a citation when the label has a definition.
    if (!target && !definitions.has(normalizeLabel(linkText))) return match;
    return `${before}[\`${linkText}\`]${target ?? ""}`;
  });
}
