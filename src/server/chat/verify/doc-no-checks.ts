// Doc-number checks: every doc number an answer mentions must exist, and a
// citation whose link text leads with one must link to that document.
import { DOC_NO_CORE } from "../../../lib/patterns.ts";
import type { Indexes } from "../../retrieval/indexes.ts";
import type { Citation } from "./citation-links.ts";

const DOC_NOS = new RegExp(String.raw`\b${DOC_NO_CORE}\b`, "g");
const LEADING_DOC_NO = new RegExp(String.raw`^${DOC_NO_CORE}\b`);

// Doc-number mentions anywhere in the answer (prose or link text): editorial
// doc_nos (A.1.6) plus the spec-invariant structural forms (.varX, NR-X). The
// letter prefix must lead straight into dotted digits, so prose like "Q1 2026"
// or "v1.2" never matches.
export function extractDocNoMentions(answer: string): string[] {
  return [...new Set(answer.match(DOC_NOS) ?? [])];
}

// Every mentioned doc number must exist in the atlas — models keep inventing
// plausible-looking numbers, and a fabricated number is a hard failure even
// when the surrounding claim is right.
export function findInvalidDocNos(answer: string, ix: Indexes): string[] {
  return extractDocNoMentions(answer).filter((d) => !ix.byDocNo.has(d));
}

// Citations whose link text leads with a doc number that is not the linked
// doc's actual number — deterministic proof of misattribution even when the
// number and the uuid both exist individually.
export function findDocNoMismatches(citations: Citation[], ix: Indexes): string[] {
  const out: string[] = [];
  for (const c of citations) {
    const claimed = c.title.match(LEADING_DOC_NO)?.[0];
    const doc = ix.docMap.get(c.uuid);
    if (claimed && doc && doc.doc_no !== claimed) out.push(`${claimed} links to ${doc.doc_no} (${doc.title})`);
  }
  return [...new Set(out)];
}
