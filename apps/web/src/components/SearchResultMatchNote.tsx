import { shortAddr } from "../lib/format";
import type { SearchHit } from "@/types";

/**
 * Why this row is in the result list, in the margin beside it.
 *
 * Three mutually exclusive shapes, in the order a reader needs them: a chainlog
 * address lookup, a meaning match, or the wording that matched.
 */
export function SearchResultMatchNote({ hit }: { hit: SearchHit }) {
  const reason = hit.chainlogId ? hit.matchReason.replace(/^chainlog \+ /, "") : hit.matchReason;
  if (hit.chainlogId) {
    return (
      <>
        <span className="text-[9px] text-tan-3">via chainlog</span>
        <span className="text-[10px] font-medium text-accent">{hit.chainlogId}</span>
        <span className="text-[9px] text-tan-3">{hit.chainlogAddress ? shortAddr(hit.chainlogAddress) : ""}</span>
      </>
    );
  }
  if (!hit.semantic) {
    return (
      <>
        <span className="text-[9px] text-tan-3">matched</span>
        <span className="text-[10px] text-tan-2">{reason}</span>
      </>
    );
  }
  // A semantic hit has a non-empty matchReason only if the wording matched too.
  // Nothing produces that today (the leg replaces rather than merges), but the
  // row stays able to say "found both ways", which is the stronger result.
  const semanticTitle = hit.viaTitle
    ? `Matched by meaning, retrieved under "${hit.viaTitle}"`
    : "Matched by meaning, not by the words you typed";
  return (
    // Deliberately louder than every other match note on the page: a semantic
    // hit can share no word with the query, so a reader who can't see WHY it is
    // here needs the answer without hunting for it.
    <>
      <span className="search-semantic-mark text-[10px]" title={semanticTitle}>
        semantic match
      </span>
      {hit.semanticScore !== undefined && <CosineNote hit={hit} score={hit.semanticScore} />}
      {reason && <span className="text-[9px] text-tan-3">+ {reason}</span>}
    </>
  );
}

/**
 * The raw cosine, two places — enough to rank neighbours against each other,
 * which is the whole use for it, without implying a precision the embedding does
 * not have.
 *
 * WHOSE score it is depends on how the row was found. A hit retrieved through a
 * grouped embedding anchor keeps the ANCHOR's cosine (`attributeSemanticHits`
 * rewrites the id to the leaf and leaves the score alone), so for those the
 * honest reading is "the group this came from", not "this document" — and
 * `viaTitle` is exactly the flag for that, since it is set on the same rows.
 */
function CosineNote({ hit, score }: { hit: SearchHit; score: number }) {
  return (
    <span
      className="text-[10px] text-tan-2"
      title={
        hit.viaTitle
          ? `Cosine similarity between your query and "${hit.viaTitle}", the group this document was found in: ${score} (0–1)`
          : `Cosine similarity between your query and this document: ${score} (0–1)`
      }
    >
      cos {score.toFixed(2)}
    </span>
  );
}
