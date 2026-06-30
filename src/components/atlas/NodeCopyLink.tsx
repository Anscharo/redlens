import { useCopyState } from "../../hooks/useCopyState";
import { track } from "../../lib/analytics";
import { type AtlasNode } from "../../types";

/** Copy-permalink button. Rendered inline to the right of the node title. */
export function NodeCopyLink({ node }: { node: AtlasNode }) {
  const urlCopy = useCopyState();

  const handleCopyUrl = (e: React.MouseEvent) => {
    e.stopPropagation();
    track("reader_copy_link", { node_id: node.id });
    const url = `${window.location.origin}${import.meta.env.BASE_URL}atlas?id=${node.id}`;
    urlCopy.copy(url);
  };

  return (
    <button
      type="button"
      onClick={handleCopyUrl}
      title={urlCopy.copied ? "Copied!" : `copy link to atlas?id=${node.id}`}
      className="atlas-copy-btn shrink-0"
      data-copied={urlCopy.copied ? "true" : undefined}
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
      <span className="atlas-copy-flip" data-flipped={urlCopy.copied ? "true" : undefined}>
        <span className="label">{`${node.id.slice(0, 4)}…${node.id.slice(-4)}`}</span>
        <span className="flipped">copied</span>
      </span>
    </button>
  );
}
