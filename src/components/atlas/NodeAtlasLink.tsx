import { type AtlasNode } from "../../types";

/**
 * Link out to the canonical Sky Atlas reader. Rendered as the third column of
 * the title row (after doc-no and title), right- and top-aligned, only when the
 * node is selected.
 */
export function NodeAtlasLink({ node }: { node: AtlasNode }) {
  return (
    <a
      href={`https://sky-atlas.io/#${node.id}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open on Sky Atlas"
      className="atlas-external-link atlas-node-outlink inline-flex items-center gap-1 shrink-0"
      onClick={(e) => e.stopPropagation()}
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
        <path d="M7 17 L17 7" />
        <path d="M9 7 H17 V15" />
      </svg>
      <img
        src={`${import.meta.env.BASE_URL}sky.png`}
        alt=""
        aria-hidden="true"
        width={14}
        height={14}
        className="block"
      />
    </a>
  );
}
