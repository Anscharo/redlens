import { memo } from "react";
import { AtlasLink } from "./AtlasLink";
import { realDepth, depthColor } from "../lib/depth";
import { atlasHref } from "../lib/routes";
import { shortAddr } from "../lib/format";
import type { HitLabel, SearchHit } from "../types";

interface Props {
  hit: SearchHit;
  rank: number; // 0-based position in the result list
  onResultClick: (hit: SearchHit, rank: number) => void;
}

// AGENT / ICD get a dim prefix tag; a bare scope label carries no prefix.
const LABEL_TAG: Record<HitLabel["kind"], string | null> = {
  scope: null,
  agent: "AGENT",
  icd: "ICD",
};
const LABEL_COLOR: Record<HitLabel["kind"], string> = {
  scope: "var(--tan-3)",
  agent: "var(--accent)",
  icd: "var(--tan-2)",
};

function GutterLabel({ label }: { label: HitLabel }) {
  const color = LABEL_COLOR[label.kind];
  const tag = LABEL_TAG[label.kind];
  return (
    <span
      className="text-[10px] leading-tight px-1.5 py-0.5 rounded max-w-full break-words"
      style={{ color, border: `1px solid color-mix(in srgb, ${color} 35%, transparent)` }}
      title={tag ? `${tag}: ${label.text}` : label.text}
    >
      {tag && <span className="opacity-60 mr-1">{tag}</span>}
      {label.text}
    </span>
  );
}

export const SearchResult = memo(function SearchResult({ hit, rank, onResultClick }: Props) {
  const color = depthColor(realDepth(hit.doc_no));
  const shortAddress = hit.chainlogAddress ? shortAddr(hit.chainlogAddress) : "";

  const reason = hit.chainlogId ? hit.matchReason.replace(/^chainlog \+ /, "") : hit.matchReason;

  return (
    <div className="relative">
      {/* Provenance labels + match info — float left on wide screens, inline on narrow */}
      <div className="lg:absolute lg:right-full lg:mr-3 lg:top-3 lg:w-[108px] lg:p-0 px-4 pt-2 mono flex flex-col gap-1.5">
        {hit.labels && hit.labels.length > 0 && (
          <div className="flex flex-wrap lg:flex-col items-start gap-1">
            {hit.labels.map((label) => (
              <GutterLabel key={label.kind + label.text} label={label} />
            ))}
          </div>
        )}
        <div className="flex items-center lg:flex-col lg:text-center gap-1.5">
          {hit.chainlogId ? (
            <>
              <span className="text-[9px] text-tan-3">via chainlog</span>
              <span className="text-[10px] font-medium text-accent">{hit.chainlogId}</span>
              <span className="text-[9px] text-tan-3">{shortAddress}</span>
            </>
          ) : (
            <>
              <span className="text-[9px] text-tan-3">matched</span>
              <span className="text-[10px] text-tan-2">{reason}</span>
            </>
          )}
        </div>
      </div>
      <AtlasLink
        to={atlasHref(hit.id)}
        className="search-result-link px-4 py-3"
        onClick={() => onResultClick(hit, rank)}
      >
        <h3
          className="text-sm font-semibold mb-1 text-tan"
          dangerouslySetInnerHTML={{ __html: hit.titleHtml }}
        />
        <div className="flex items-center gap-3 mb-1">
          <span
            className="text-[11px] font-medium px-1.5 py-0.5 rounded mono badge"
            style={{
              color,
              border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
            }}
          >
            {hit.type}
          </span>
          <span className="text-xs mono text-tan-2">{hit.doc_no}</span>
          <span className="text-[10px] mono text-tan-3">{hit.id}</span>
        </div>
        {hit.snippet && (
          <p
            className="text-sm leading-snug line-clamp-2 text-tan-2"
            dangerouslySetInnerHTML={{ __html: hit.snippet }}
          />
        )}
      </AtlasLink>
    </div>
  );
});
