import { useRouter } from "wouter";
import { useCopyState } from "../../hooks/useCopyState";
import { track } from "../../lib/analytics";
import { type AtlasNode } from "@/types";

export function NodeMeta({ node }: { node: AtlasNode }) {
  const urlCopy = useCopyState();
  const docNoCopy = useCopyState();
  // Router base is "" on the live atlas and "/preview/<id>" in preview mode, so
  // the copied link stays within the same source the user is viewing.
  const { base } = useRouter();

  const handleCopyUrl = (e: React.MouseEvent) => {
    e.stopPropagation();
    track("reader_copy_link", { node_id: node.id });
    const url = `${window.location.origin}${base}/atlas?id=${node.id}`;
    urlCopy.copy(url);
  };

  const handleCopyDocNo = (e: React.MouseEvent) => {
    e.stopPropagation();
    track("reader_copy_doc_no", { node_id: node.id, doc_no: node.doc_no });
    docNoCopy.copy(node.doc_no);
  };

  return (
    <div className="flex items-center gap-3 shrink-0">
      <span className="atlas-type-pill">{node.type}</span>
      <button
        type="button"
        onClick={handleCopyDocNo}
        title={docNoCopy.copied ? "Copied!" : `Copy ${node.doc_no}`}
        className="atlas-copy-btn"
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
          <span className="label">{node.doc_no}</span>
          <span className="flipped">copied</span>
        </span>
      </button>
      <button
        type="button"
        onClick={handleCopyUrl}
        title={urlCopy.copied ? "Copied!" : `Copy link · ${node.id}`}
        className="atlas-copy-btn"
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
          <span className="label">{`${node.id.slice(0, 3)}…${node.id.slice(-3)}`}</span>
          <span className="flipped">copied</span>
        </span>
      </button>
      <a
        href={`https://sky-atlas.io/#${node.id}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open on Sky Atlas"
        className="atlas-external-link shrink-0 inline-flex items-center"
        onClick={(e) => {
          e.stopPropagation();
          track("reader_atlas_link_out", { node_id: node.id });
        }}
      >
        <img
          src={`${import.meta.env.BASE_URL}sky.png`}
          alt=""
          aria-hidden="true"
          width={14}
          height={14}
          className="block"
        />
      </a>
    </div>
  );
}
