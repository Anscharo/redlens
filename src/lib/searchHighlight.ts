const ESC_HTML = (c: string) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!;
const ESC_RE = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Single-pass highlight over plain text (HTML-escaped first).
// Three tiers in priority order — higher tiers win when ranges overlap:
//   casePhrases → exact case-sensitive, no word-extension
//   phrases     → exact case-insensitive, no word-extension
//   terms       → prefix case-insensitive, with \w* word-extension
export function applyHighlight(
  raw: string,
  terms: string[],
  phrases: string[],
  casePhrases: string[],
): string {
  type Entry = { pattern: string; exact: string; caseSensitive: boolean };
  const entries: Entry[] = [];

  for (const p of casePhrases) if (p.length >= 2) entries.push({ pattern: "\\b" + ESC_RE(p) + "\\b", exact: p, caseSensitive: true });
  for (const p of phrases)    if (p.length >= 2) entries.push({ pattern: "\\b" + ESC_RE(p) + "\\b", exact: p, caseSensitive: false });
  for (const t of terms)      if (t.length >= 2) entries.push({ pattern: ESC_RE(t), exact: "", caseSensitive: false });

  if (entries.length === 0) return raw.replace(/[&<>"]/g, ESC_HTML);

  // Match against the RAW (unescaped) text so a term like "amp"/"quot" can't
  // land inside an HTML entity produced by escaping (e.g. "R&D" -> "R&amp;D",
  // where matching post-escape would highlight inside the "&amp;" entity and
  // corrupt the markup when rendered via dangerouslySetInnerHTML). Escaping
  // happens per-segment below, after match boundaries are known.
  const re = new RegExp(entries.map((e) => `(${e.pattern})`).join("|"), "gi");

  let out = "";
  let last = 0;
  for (const m of raw.matchAll(re)) {
    const match = m[0];
    const groups = m.slice(1, entries.length + 1);
    const idx = groups.findIndex((g) => g !== undefined);
    const entry = idx === -1 ? undefined : entries[idx];
    // Reject a case-insensitive hit for a case-sensitive pattern.
    const accept = entry && (!entry.caseSensitive || match === entry.exact);
    out += raw.slice(last, m.index).replace(/[&<>"]/g, ESC_HTML);
    const escapedMatch = match.replace(/[&<>"]/g, ESC_HTML);
    out += accept ? `<mark>${escapedMatch}</mark>` : escapedMatch;
    last = m.index + match.length;
  }
  out += raw.slice(last).replace(/[&<>"]/g, ESC_HTML);
  return out;
}

export function buildSnippet(
  content: string,
  terms: string[],
  phrases: string[],
  casePhrases: string[],
): string {
  if (!content) return "";

  const WINDOW = 160;
  const lower = content.toLowerCase();

  // Anchor on the most specific match first: case-sensitive phrase > case-insensitive phrase > term
  // Phrases use \b so anchoring must too — indexOf("test") would land on "tests".
  let bestPos = -1;
  for (const p of casePhrases) {
    const m = new RegExp("\\b" + ESC_RE(p) + "\\b").exec(content);
    if (m) { bestPos = m.index; break; }
  }
  if (bestPos === -1) {
    for (const p of phrases) {
      const m = new RegExp("\\b" + ESC_RE(p) + "\\b", "i").exec(content);
      if (m) { bestPos = m.index; break; }
    }
  }
  if (bestPos === -1) {
    for (const t of terms) {
      const pos = lower.indexOf(t.toLowerCase());
      if (pos !== -1 && (bestPos === -1 || pos < bestPos)) bestPos = pos;
    }
  }

  if (bestPos === -1) return content.slice(0, WINDOW) + (content.length > WINDOW ? "…" : "");

  const start = Math.max(0, bestPos - 60);
  const end = Math.min(content.length, start + WINDOW);
  const excerpt = (start > 0 ? "…" : "") + content.slice(start, end) + (end < content.length ? "…" : "");

  return applyHighlight(excerpt, terms, phrases, casePhrases);
}

export function highlightTerms(
  text: string,
  terms: string[],
  phrases: string[] = [],
  casePhrases: string[] = [],
): string {
  return applyHighlight(text, terms, phrases, casePhrases);
}

export function extractPhrases(q: string): {
  phrases: string[];
  casePhrases: string[];
  rest: string;
} {
  const phrases: string[] = [];
  const casePhrases: string[] = [];
  let rest = q.replace(/"([^"]+)"/g, (_, p: string) => {
    const trimmed = p.trim();
    if (trimmed) phrases.push(trimmed);
    return ` ${p} `;
  });
  // Single quotes → case-sensitive exact match. The quotes must sit at
  // non-alphanumeric boundaries so apostrophes inside words (contractions,
  // possessives: don't, Sky's) aren't mistaken for phrase delimiters — a query
  // like `don't won't` used to capture `t won` as a required case-sensitive
  // phrase and then match zero docs.
  rest = rest.replace(/(?<![A-Za-z0-9])'([^']+?)'(?![A-Za-z0-9])/g, (_, p: string) => {
    const trimmed = p.trim();
    if (trimmed) casePhrases.push(trimmed);
    return ` ${p} `;
  });
  return { phrases, casePhrases, rest };
}
