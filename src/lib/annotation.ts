// Annotation docs are numbered `<target>.0.3.N` — a structural suffix the
// syntax spec (vendor/next-gen-atlas/ATLAS_MARKDOWN_SYNTAX.md) guarantees, so
// matching it is stable in the way a doc_no used as an identifier never is.
//
// The suffix is also why annotations MISREAD on screen: indentation in both the
// tree and the reader is a product of doc-number length, so `A.2.8.0.3.2` sits
// three columns deeper than `A.2.8` — as if it were nested under one of that
// article's children, when it hangs directly off the article itself. Callers
// use this module to pull annotations back: label what they annotate, de-emphasise
// the three bookkeeping segments, and drop the reserved chevron column.
const ANNOTATION_SUFFIX = /\.0\.3\.\d+$/;

/** Segments an annotation's doc_no adds over its target's: "0", "3", the index. */
export const ANNOTATION_TAIL_SEGMENTS = 3;

/**
 * The doc_no of the document this annotation annotates, or null if `doc_no`
 * isn't shaped like an annotation's.
 *
 * Derived from the doc_no, NOT from `parentId`: the parser's ancestor stack is
 * indexed by heading depth, which the atlas caps at 6, so a deeply-numbered
 * annotation (`A.3.3.2.7.1.1.1.3.0.3.1`) is reparented onto an ancestor several
 * levels above its real target. 8 of the 68 annotations are affected.
 */
export function annotatedDocNo(doc_no: string): string | null {
  const target = doc_no.replace(ANNOTATION_SUFFIX, "");
  return target === doc_no || target === "" ? null : target;
}

/** Type + numbering both have to agree before a row gets annotation treatment. */
export function annotationTarget(node: { type: string; doc_no: string }): string | null {
  return node.type === "Annotation" ? annotatedDocNo(node.doc_no) : null;
}
