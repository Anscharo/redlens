// Extraction half of the A1 citation-support check (cite-support.ts judges).
// Turns an answer into (claim, cited doc) pairs that are actually worth a
// judgment. The first bakeoff found three causes of false flags; two were
// here, not in the model — it was being handed things that are not claims.
// (The third, pointer citations, is a question-design fix: the
// `about_document` option in cite-support.ts.)
//
//   1. TABLE ROWS were judged as raw `| a | b | c |` strings with the header
//      thrown away, so "Sky Core | 5M USDS | Planned" reached the judge with no
//      way to know which cell was a sender and which an amount. Tables are now
//      rewritten row by row into labelled prose before segmentation
//      ("Sender: Sky Core; Amount(s): 5M USDS; …"), which is what the row
//      MEANS, and link-only cells are moved behind the period so the existing
//      trailing-citation fold attaches them to the row's claim.
//   2. DEGENERATE SEGMENTS — a bold bullet label like `* **Spark**:` whose
//      only other content was a link — were judged as claims. A pair now needs
//      at least three real words once links and markup are gone.
//
// Segmentation itself is still `claimSegments`, shared with the lexical check
// findLowOverlapCitations, so the two cannot disagree on what a sentence is.
import { claimSegments, extractCitations, MD_LINK_SRC } from "./verify-checks.ts";

export interface CitationPair {
  /** The claim, with its link markup stripped (link TEXT is usually the doc's own title, which would beg the question). */
  claim: string;
  /** The doc that claim links to. */
  uuid: string;
}

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const ONLY_LINKS = new RegExp(`^(?:\\s*${MD_LINK_SRC}\\s*[,;]?)+\\s*$`);

const cellsOf = (row: string) =>
  row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim().replace(/\*\*/g, ""));

/** Rewrites every markdown table into one labelled-prose line per data row. */
export function tablesAsProse(answer: string): string {
  const lines = answer.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!(TABLE_ROW.test(lines[i]) && TABLE_SEP.test(lines[i + 1] ?? ""))) {
      out.push(lines[i]);
      continue;
    }
    const header = cellsOf(lines[i]);
    i += 1; // the separator
    while (i + 1 < lines.length && TABLE_ROW.test(lines[i + 1])) {
      i += 1;
      const cells = cellsOf(lines[i]);
      const text: string[] = [];
      const links: string[] = [];
      cells.forEach((cell, k) => {
        if (!cell) return;
        if (ONLY_LINKS.test(cell)) links.push(cell);
        else text.push(`${header[k] || `Column ${k + 1}`}: ${cell}`);
      });
      if (text.length) out.push(`${text.join("; ")}.${links.length ? ` ${links.join(" ")}` : ""}`);
    }
  }
  return out.join("\n");
}

/** Link-stripped, markup-stripped, with the debris stripped links leave behind. */
function cleanClaim(seg: string): string {
  return seg
    .replace(new RegExp(MD_LINK_SRC, "g"), " ")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, "") // list marker
    .replace(/\*\*|__|`/g, "")
    .replace(/\(\s*[,;\s]*\)/g, "") // "( )" and "( , )" left by removed links
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([,;])(?:\s*[,;])+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// Three words of at least two letters. `* **Spark**:` has one.
const MIN_CLAIM_WORDS = 3;
const realWords = (s: string) => (s.match(/[A-Za-z]{2,}/g) ?? []).length;

/**
 * Every (claim, cited doc) pair in an answer that is worth judging. De-duplicated
 * on (doc, claim), so a sentence repeated verbatim is one judgment, not two.
 */
export function citationPairs(answer: string): CitationPair[] {
  const out: CitationPair[] = [];
  const seen = new Set<string>();
  for (const seg of claimSegments(tablesAsProse(answer))) {
    const cites = extractCitations(seg);
    if (!cites.length) continue;
    const claim = cleanClaim(seg);
    if (realWords(claim) < MIN_CLAIM_WORDS) continue;
    for (const c of cites) {
      const key = `${c.uuid}|${claim}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ claim, uuid: c.uuid });
    }
  }
  return out;
}
