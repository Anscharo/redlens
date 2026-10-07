// A PR preview's text in the evidence (atlas_preview_diff / atlas_preview_get,
// whose results lead with the source_class marker) is a proposed Atlas. The
// deterministic checks compare an answer with the LIVE Atlas, so without this
// a faithful review hard-fails: a document the PR adds has a doc_no the live
// Atlas lacks, and a value the PR changes differs from the live parameter.
// What appears in the preview evidence is exempt from those two checks only;
// quotes, citations and addresses are judged as before. Text the preview
// result carries from elsewhere (AUTHOR_KEYS: the PR author's description, the
// builder's error) is not proposed Atlas text and earns no exemption.
import { DOC_NO_CORE } from "../../../lib/patterns.ts";

const PREVIEW_MARKS = ['"source_class":"preview"', '\\"source_class\\":\\"preview\\"'];

// Keys whose string values are left out of the preview evidence; the tools that
// write them are tools-preview-common.ts and tools-preview.ts.
const AUTHOR_KEYS = ["pr_description", "build_error"];

/** `t` without the values of AUTHOR_KEYS, at any JSON escape depth: a result
 *  cut by the chat budget is nested as an escaped string (preview_json). At
 *  depth n a quote is preceded by q = 2^n - 1 backslashes, and the value's
 *  closing quote is the first whose backslash run is q modulo 2(q + 1). A value
 *  the budget cut off runs to the end of the text. */
export function withoutAuthorText(t: string): string {
  let out = t;
  for (const key of AUTHOR_KEYS) {
    const open = new RegExp(String.raw`(\\*)"${key}\1":\1"`, "g");
    let m: RegExpExecArray | null;
    while ((m = open.exec(out))) {
      const start = m.index + m[0].length;
      const end = closingQuote(out, start, m[1].length);
      out = out.slice(0, start) + out.slice(end);
      open.lastIndex = start;
    }
  }
  return out;
}

function closingQuote(t: string, from: number, q: number): number {
  for (let i = from; i < t.length; i++) {
    if (t[i] !== '"') continue;
    let run = 0;
    while (i - run - 1 >= from && t[i - run - 1] === "\\") run++;
    if (run % (2 * (q + 1)) === q) return i - q;
  }
  return t.length;
}

export interface PreviewEvidence {
  /** False for a doc_no the preview evidence names. */
  unknownDocNo: (docNo: string) => boolean;
  /** False for a mismatch whose stated value the preview evidence contains. */
  unproposed: (m: { stated: string }) => boolean;
}

export function previewEvidence(texts: readonly string[]): PreviewEvidence {
  const pv = texts.filter((t) => PREVIEW_MARKS.some((mark) => t.includes(mark))).map(withoutAuthorText);
  if (pv.length === 0) return { unknownDocNo: () => true, unproposed: () => true };
  const docNos = new Set(pv.flatMap((t) => t.match(new RegExp(String.raw`\b${DOC_NO_CORE}\b`, "g")) ?? []));
  return {
    unknownDocNo: (d) => !docNos.has(d),
    unproposed: (m) => !pv.some((t) => t.includes(m.stated)),
  };
}
