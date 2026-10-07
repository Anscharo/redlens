// One collator so every doc_no ordering (reader, reports, embeddings, builds) agrees:
// `A.2.10` sorts after `A.2.9`, independent of the host locale.
const DOC_NO_COLLATOR = new Intl.Collator("en", { numeric: true });

/** Compares two doc_no strings numerically per segment. */
export function cmpDocNo(a: string, b: string): number {
  return DOC_NO_COLLATOR.compare(a, b);
}

/** Comparator for anything carrying a `doc_no`. */
export const byDocNo = (a: { doc_no: string }, b: { doc_no: string }): number => cmpDocNo(a.doc_no, b.doc_no);
