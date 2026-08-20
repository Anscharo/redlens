// Citation syntax shared by the answer renderer (AtlasMarkdown) and the
// Sources cluster (extractSources). See docs/plans/reference-citations.md.

// Reference-style definitions: a definition block (`[label]: /atlas/<uuid>`,
// normally at the top of the answer, but may appear anywhere). Label matching
// is case-insensitive and whitespace-normalized, per CommonMark. Up to 3
// leading spaces are tolerated (CommonMark allows that much indentation before
// a definition still counts).
export const DEFINITION_RE = /^[ \t]{0,3}\[([^\]\n]+)\]:\s*\/atlas\/([0-9a-f-]{36})\s*$/gim;

export function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

/** normalized label -> lowercased uuid, first definition wins. */
export function parseDefinitions(content: string): Map<string, string> {
  const definitions = new Map<string, string>();
  for (const m of content.matchAll(DEFINITION_RE)) {
    const label = normalizeLabel(m[1]);
    if (!definitions.has(label)) definitions.set(label, m[2].toLowerCase());
  }
  return definitions;
}

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
