// A PR preview's text in the evidence (atlas_preview_diff / atlas_preview_get,
// whose results lead with the source_class marker) is a proposed Atlas. The
// deterministic checks compare an answer with the LIVE Atlas, so without this
// a faithful review hard-fails: a document the PR adds has a doc_no the live
// Atlas lacks, and a value the PR changes differs from the live parameter.
// What appears in the preview evidence is exempt from those two checks only;
// quotes, citations and addresses are judged as before.
import { DOC_NO_CORE } from "../../../lib/patterns.ts";

const PREVIEW_MARKS = ['"source_class":"preview"', '\\"source_class\\":\\"preview\\"'];

export interface PreviewEvidence {
  /** False for a doc_no the preview evidence names. */
  unknownDocNo: (docNo: string) => boolean;
  /** False for a mismatch whose stated value the preview evidence contains. */
  unproposed: (m: { stated: string }) => boolean;
}

export function previewEvidence(texts: readonly string[]): PreviewEvidence {
  const pv = texts.filter((t) => PREVIEW_MARKS.some((mark) => t.includes(mark)));
  if (pv.length === 0) return { unknownDocNo: () => true, unproposed: () => true };
  const docNos = new Set(pv.flatMap((t) => t.match(new RegExp(String.raw`\b${DOC_NO_CORE}\b`, "g")) ?? []));
  return {
    unknownDocNo: (d) => !docNos.has(d),
    unproposed: (m) => !pv.some((t) => t.includes(m.stated)),
  };
}
