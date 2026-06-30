import { useCopyState } from "../../hooks/useCopyState";
import { track } from "../../lib/analytics";
import { type AtlasNode } from "../../types";

/**
 * Abbreviated doc-no for the corner affordance: doc numbers deeper than four
 * levels collapse to `scope..lastThree` (e.g. `A.6.1.1.10.1` → `A.6..1.10.1`)
 * so the corner stays compact. Four or fewer levels (and NR-X tokens, which
 * don't split on ".") render in full.
 */
function abbreviateDocNo(docNo: string): string {
  const parts = docNo.split(".");
  if (parts.length <= 4) return docNo;
  return `${parts.slice(0, 2).join(".")}..${parts.slice(-3).join(".")}`;
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
