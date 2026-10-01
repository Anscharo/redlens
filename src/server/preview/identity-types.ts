// Shapes shared by the identity gate's modules (identity.ts and identity-*.ts).

export interface IdentitySwap {
  /** Title the UUID had on the live atlas. */
  oldTitle: string;
  /** Title the UUID has in this preview. */
  newTitle: string;
  /** Best-effort: the preview doc (new UUID) that received the old content. */
  movedTo?: { id: string; doc_no: string; title: string };
}

export interface FormerUuid {
  /** The UUID this content used to live under on the live atlas. */
  previousId: string;
  previousTitle: string;
  previousDocNo: string;
}

/** Minimal doc shape the gate needs — both AtlasNode (live) and preview
 *  docs.json nodes satisfy it. */
export interface SwapNode {
  id: string;
  doc_no: string;
  title?: string;
  content?: string;
}

/** The cosine between a document's old and new search vectors, or undefined
 *  when the caller has none for it — no vectors at all, a vector that failed
 *  to load, or a document search stores as a GROUP, whose vector is not a
 *  vector of the document alone. Supplied by the caller so the gate stays
 *  free of IO; the same shape as embed-units' LeafSemanticScore. */
export type BodySimilarity = (id: string) => number | undefined;
