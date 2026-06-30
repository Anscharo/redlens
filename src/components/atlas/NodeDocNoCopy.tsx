import { useCopyState } from "../../hooks/useCopyState";
import { track } from "../../lib/analytics";
import { type AtlasNode } from "../../types";

const HEAD_LEVELS = 2;
const TAIL_LEVELS = 3;

/**
 * Abbreviated doc-no for the corner affordance: doc numbers that omit inner
 * levels collapse to `head…tail` (e.g. `A.6.1.1.10.1` → `A.6.….1.10.1`) with a
 * single ellipsis segment standing in for the skipped middle. Numbers short
 * enough that nothing would be skipped (≤ HEAD+TAIL levels) — and NR-X tokens,
 * which don't split on "." — render in full with no ellipsis.
 */
function abbreviateDocNo(docNo: string): string {
  const parts = docNo.split(".");
  if (parts.length <= HEAD_LEVELS + TAIL_LEVELS) return docNo;
  return [...parts.slice(0, HEAD_LEVELS), "…", ...parts.slice(-TAIL_LEVELS)].join(".");
}

/**
 * Copy-doc-number button. Rendered in the selected node's top-right corner, to
 * the left of the copy-permalink. Shows a copy icon followed by the doc number
 * (abbreviated when deeper than four levels); copies the full doc_no on click.
 */
export function NodeDocNoCopy({ node }: { node: AtlasNode }) {
  const docNoCopy = useCopyState();

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    track("reader_copy_doc_no", { node_id: node.id, doc_no: node.doc_no });
    docNoCopy.copy(node.doc_no);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={docNoCopy.copied ? "Copied!" : `Copy ${node.doc_no}`}
      aria-label={`Copy doc number ${node.doc_no}`}
      className="atlas-copy-btn shrink-0"
      data-copied={docNoCopy.copied ? "true" : undefined}
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <rect x="4" y="4" width="7" height="7" rx="1" />
        <path d="M1 8V2C1 1.45 1.45 1 2 1H8" />
      </svg>
      <span className="atlas-copy-flip" data-flipped={docNoCopy.copied ? "true" : undefined}>
        <span className="label">{abbreviateDocNo(node.doc_no)}</span>
        <span className="flipped">copied</span>
      </span>
    </button>
  );
}
