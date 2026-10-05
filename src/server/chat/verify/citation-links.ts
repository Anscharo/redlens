// Citation links in an answer: the link format, extracting them, and the
// checks on their shape (well-formed href, known uuid, uncited paragraphs).
import { UUID_RE } from "../../../lib/patterns.ts";
import type { Indexes } from "../../retrieval/indexes.ts";

// The system prompt's citation link format: [Title](/atlas/<uuid>). ONE source
// of truth shared with scripts/aux/eval-golden-grade.ts so grader and runtime
// can't drift. Exported as a source string (not a RegExp) because the runtime
// needs a fresh /g instance per scan — shared global regexes carry lastIndex.
export const CITATION_SRC = `\\[([^\\]]+)\\]\\(/atlas/(${UUID_RE.source.slice(1, -1)})\\)`;

// A markdown link, bounded on BOTH parts. The bounds are load-bearing, not
// cosmetic: evidence is JSON full of stray "[" (e.g. "sources":["lexical"]),
// and an unbounded `[^\]]+` will happily run across newlines and quotes until
// some later "](" — swallowing hundreds of characters of real evidence and
// silently turning faithful quotes into "fabrications". Link text is
// single-line and short; an href never contains whitespace.
export const MD_LINK_SRC = String.raw`\[([^\]\n]{1,120})\]\([^)\s]*\)`;

export interface Citation {
  title: string;
  uuid: string;
}

export function extractCitations(answer: string): Citation[] {
  const re = new RegExp(CITATION_SRC, "gi");
  const out: Citation[] = [];
  for (let m = re.exec(answer); m; m = re.exec(answer)) {
    out.push({ title: m[1], uuid: m[2].toLowerCase() });
  }
  return out;
}

// Links into the reader that are NOT well-formed uuid citations — e.g. a
// doc_no or a truncated uuid in the href. Signals the model inventing hrefs.
export function findBareAtlasLinks(answer: string): string[] {
  const re = /\]\((\/atlas\/[^)\s]*)\)/g;
  const wellFormed = new RegExp(`^/atlas/${UUID_RE.source.slice(1, -1)}$`, "i");
  const out: string[] = [];
  for (let m = re.exec(answer); m; m = re.exec(answer)) {
    if (!wellFormed.test(m[1])) out.push(m[1]);
  }
  return out;
}

export function findInvalidCitationUuids(citations: Citation[], ix: Indexes): string[] {
  return [...new Set(citations.filter((c) => !ix.docMap.has(c.uuid)).map((c) => c.uuid))];
}

// Substantive paragraphs with no citation link. A soft signal (the answer's
// lead sentence or a summary bullet legitimately goes uncited) — reported to
// the verifier prompt, never a hard failure on its own.
export function countUncitedParagraphs(answer: string): number {
  const citation = new RegExp(CITATION_SRC, "i");
  return answer
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 120 && !/^#{1,6}\s/.test(p) && !p.startsWith("|"))
    .filter((p) => !citation.test(p)).length;
}
