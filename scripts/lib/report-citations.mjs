// Citation gate for Atlas-derived reports.
//
// Core dictate (CLAUDE.md): any concrete normative claim about what "must" /
// "has to" / "needs to" / "should" happen — in a report written to a file,
// remote storage (Notion), or the RedLens site — must carry an Atlas reference
// IN CONTEXT: inline on the same line, or in a footnote the claim references
// directly. A trailing "references" section that the claim does not point at
// does NOT satisfy the rule (it is not "referenced by the claim directly").
//
// This module is the shared detector. It is dependency-free Node ESM so it can
// be imported by the Bun-run Notion publisher, the `cite:check` CLI, and tests.

// --- What counts as a normative ("has-to") claim -----------------------------
// Deliberately broad. A security-review report should over-flag rather than let
// an uncited requirement through; the escape hatch handles legitimate prose.
const NORMATIVE_PATTERNS = [
  /\bmust(?:\s+not)?\b/i,
  /\bshall(?:\s+not)?\b/i,
  /\bshould(?:n['’]?t)?\b/i,
  /\bneeds?\s+to\b/i,
  /\bneeds?\s+(?:at\s+least|a\s+minimum(?:\s+of)?|≥|>=)/i,
  /\b(?:has|have|had)\s+to\b/i,
  /\brequire(?:s|d|ment|ments)?\b/i,
  /\bmandatory\b/i,
  /\bobligat(?:ed|ion|ions)\b/i,
  /\bcannot\b/i,
  /\bcan['’]?t\b/i,
  /\bmay\s+not\b/i,
  /\b(?:not\s+permitted|prohibited|forbidden|disallowed)\b/i,
  /\bat\s+least\s+\d/i,
  /\bno\s+fewer\s+than\b/i,
  /\bminimum\s+of\s+\d/i,
  /\bat\s+minimum\b/i,
  /(?:^|[\s(])(?:≥|>=)\s*\d/,
];

// --- What counts as an Atlas citation ----------------------------------------
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
// Atlas doc numbers: a scope letter, a dot, then dotted digits — A.2.7.1.1.1.1.4.0.6.1,
// A.1.13.1.3.1, etc. Plus the spec-defined global Needed-Research form NR-12.
const DOCNO_RE = /\b[A-Z]\.\d+(?:\.\d+)*\b/;
const NR_RE = /\bNR-\d+\b/;
// An atlas hyperlink in either the app or the public host.
const ATLAS_LINK_RE = /(?:\/atlas[/?]|atlas\.redline\.support)/i;

/** True if `text` contains any Atlas reference token (doc_no, UUID, or atlas link). */
export function hasCitation(text) {
  if (!text) return false;
  return (
    UUID_RE.test(text) || DOCNO_RE.test(text) || NR_RE.test(text) || ATLAS_LINK_RE.test(text)
  );
}

/** True if `line` reads as a normative "has-to" claim. */
export function isNormativeClaim(line) {
  return NORMATIVE_PATTERNS.some((re) => re.test(line));
}

// Strip fenced code blocks so `must`/`should` inside code samples never flag.
function splitLinesSkippingCode(markdown) {
  const raw = markdown.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let inFence = false;
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i].trim();
    if (t.startsWith("```")) {
      inFence = !inFence;
      out.push({ lineNo: i + 1, text: raw[i], code: true });
      continue;
    }
    out.push({ lineNo: i + 1, text: raw[i], code: inFence });
  }
  return out;
}

const FOOTNOTE_DEF_RE = /^\s*\[\^([^\]]+)\]:\s*(.*)$/;
const FOOTNOTE_REF_RE = /\[\^([^\]]+)\]/g;

/**
 * Analyze a report's markdown for the citation dictate.
 * @param {string} markdown
 * @returns {{ claims: Array<{lineNo:number,text:string,cited:boolean,via:string}>, uncited: Array<{lineNo:number,text:string}> }}
 */
export function analyzeReportCitations(markdown) {
  const lines = splitLinesSkippingCode(markdown);

  // Table header rows are column labels, not claims (like headings). A header is
  // the nearest preceding non-blank line above a `|---|` separator row.
  const TABLE_SEP_RE = /^\|[\s:|-]+\|$/;
  const headerLineNos = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].code) continue;
    if (!TABLE_SEP_RE.test(lines[i].text.trim())) continue;
    for (let j = i - 1; j >= 0; j--) {
      if (lines[j].code || !lines[j].text.trim()) continue;
      headerLineNos.add(lines[j].lineNo);
      break;
    }
  }

  // Pass 1: collect footnote-definition ids that themselves carry a citation.
  const citedFootnoteIds = new Set();
  for (const { text, code } of lines) {
    if (code) continue;
    const m = FOOTNOTE_DEF_RE.exec(text);
    if (m && hasCitation(m[2])) citedFootnoteIds.add(m[1]);
  }

  // A blockquote is a quotation of a cited source when the attribution lead-in
  // line just above it carries the citation (e.g. `Threshold Requirements ·
  // A.2.11…:` followed by a `>` quote of the rule). The quoted claim is then
  // cited "in context" — and we must never edit verbatim quote text to satisfy a
  // linter. Returns true if the nearest preceding non-blank, non-quote line has a
  // citation.
  const isQuote = (t) => t.startsWith(">");
  function attributionCited(idx) {
    for (let j = idx - 1; j >= 0; j--) {
      const t = lines[j].text.trim();
      if (!t) continue;
      if (isQuote(t)) continue; // still inside the same quote block
      return hasCitation(t);
    }
    return false;
  }

  // Pass 2: evaluate each candidate claim line.
  const claims = [];
  for (let i = 0; i < lines.length; i++) {
    const { lineNo, text, code } = lines[i];
    if (code) continue;
    const trimmed = text.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue; // headings are labels, not claims
    if (headerLineNos.has(lineNo)) continue; // table header row (column labels)
    if (FOOTNOTE_DEF_RE.test(trimmed)) continue; // the footnote body itself
    if (TABLE_SEP_RE.test(trimmed)) continue; // table separator row
    if (!isNormativeClaim(trimmed)) continue;

    // Inline citation on the same line (covers a "Source" table cell too, since a
    // markdown table row is a single line).
    if (hasCitation(trimmed)) {
      claims.push({ lineNo, text: trimmed, cited: true, via: "inline" });
      continue;
    }
    // Footnote the claim references directly, whose definition carries a citation.
    let viaFootnote = false;
    for (const fm of trimmed.matchAll(FOOTNOTE_REF_RE)) {
      if (citedFootnoteIds.has(fm[1])) { viaFootnote = true; break; }
    }
    if (viaFootnote) { claims.push({ lineNo, text: trimmed, cited: true, via: "footnote" }); continue; }
    // Quoted Atlas text attributed by its lead-in citation line.
    if (isQuote(trimmed) && attributionCited(i)) {
      claims.push({ lineNo, text: trimmed, cited: true, via: "quote-attribution" });
      continue;
    }
    claims.push({ lineNo, text: trimmed, cited: false, via: "none" });
  }

  return { claims, uncited: claims.filter((c) => !c.cited).map(({ lineNo, text }) => ({ lineNo, text })) };
}

/** Format uncited findings for a terminal / error message. */
export function formatUncited(uncited, label = "report") {
  if (!uncited.length) return `✓ ${label}: every normative claim carries an in-context Atlas citation.`;
  const lines = [
    `✗ ${label}: ${uncited.length} normative claim(s) lack an in-context Atlas citation.`,
    `  Each must cite the Atlas doc that dictates it — inline (doc_no like A.2.7…, a UUID, or an`,
    `  /atlas link) or a footnote the claim references directly. See CLAUDE.md “Citation dictate”.`,
    ``,
  ];
  for (const u of uncited) lines.push(`  line ${u.lineNo}: ${u.text}`);
  return lines.join("\n");
}
