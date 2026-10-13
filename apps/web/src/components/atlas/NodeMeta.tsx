import { useRouter } from "wouter";
import { track } from "../../lib/analytics";
import { type AtlasNode } from "@/types";
import { CopyButton } from "./CopyButton";
import { ChainLinkIcon, CopyIcon, LinkOutIcon, SkyLogo } from "./NodeMetaIcons";

export function NodeMeta({ node }: { node: AtlasNode }) {
  const skyAtlasUrl = `https://sky-atlas.io/#${node.id}`;
  // Router base is "" on the live atlas and "/preview/<id>" in preview mode, so
  // the copied link stays within the same source the user is viewing.
  const { base } = useRouter();

  return (
    <div className="flex items-center gap-3 shrink-0">
      <span className="atlas-type-pill">{node.type}</span>
      <CopyButton
        icon={<CopyIcon />}
        label={node.doc_no}
        title={`Copy ${node.doc_no}`}
        text={node.doc_no}
        onCopy={() => track("reader_copy_doc_no", { node_id: node.id, doc_no: node.doc_no })}
      />
      <CopyButton
        icon={<ChainLinkIcon />}
        label={`${node.id.slice(0, 3)}…${node.id.slice(-3)}`}
        title={`Copy link · ${node.id}`}
        text={() => `${window.location.origin}${base}/atlas?id=${node.id}`}
        onCopy={() => track("reader_copy_link", { node_id: node.id })}
      />
      <CopyButton
        icon={<CopyIcon />}
        label={
          <span className="pl-0.5">
            <SkyLogo />
          </span>
        }
        title="Copy link to Sky Atlas"
        aria-label="Copy link to Sky Atlas"
        text={skyAtlasUrl}
        onCopy={() => track("reader_copy_sky_atlas_link", { node_id: node.id })}
      />
      <a
        href={skyAtlasUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open on Sky Atlas"
        className="atlas-external-link shrink-0 inline-flex items-center gap-1"
        onClick={(e) => {
          e.stopPropagation();
          track("reader_atlas_link_out", { node_id: node.id });
        }}
      >
        <SkyLogo />
        <LinkOutIcon />
      </a>
    </div>
  );
}
