// One collator so every doc_no ordering (reader, reports, embeddings, builds) agrees:
// `A.2.10` sorts after `A.2.9`, independent of the host locale.
const DOC_NO_COLLATOR = new Intl.Collator("en", { numeric: true });

/** Compares two doc_no strings numerically per segment. */
export function cmpDocNo(a: string, b: string): number {
  return DOC_NO_COLLATOR.compare(a, b);
}

const DOC_NO_RE = /^[A-Z][A-Z0-9]*(?:\.\w+)+$|^NR-\d+$/i;
const BARE_DOC_NO_RE = /^\d+(?:\.(?:\d+|var\d+))+$/i;

/**
 * The doc_no a typed doc number names ("A.1.2", "1.2", "NR-12"), or null when
 * it is not one. A bare "6.1.2" names A.6.1.2: every numbered document sits
 * under the A. root. Doc numbers are an uppercase root then lowercase segments
 * ("A.1.2.1.var1"), so that is the case returned, whatever case was typed.
 */
export function docNoKey(typed: string): string | null {
  const s = BARE_DOC_NO_RE.test(typed) ? `A.${typed}` : typed;
  if (!DOC_NO_RE.test(s)) return null;
  return s.toLowerCase().replace(/^[^.]+/, (root) => root.toUpperCase());
}

/** Comparator for anything carrying a `doc_no`. */
export const byDocNo = (a: { doc_no: string }, b: { doc_no: string }): number => cmpDocNo(a.doc_no, b.doc_no);
