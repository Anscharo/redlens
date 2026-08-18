import { memo } from "react";
import { AtlasLink } from "./AtlasLink";
import { SearchResultSelectBox } from "./SearchResultSelectBox";
import { realDepth, depthColor } from "../lib/depth";
import { atlasHref } from "../lib/routes";
import { shortAddr } from "../lib/format";
import type { HitLabel, SearchHit } from "../types";

interface Props {
  hit: SearchHit;
  rank: number; // 0-based position in the result list
  onResultClick: (hit: SearchHit, rank: number) => void;
}

// AGENT / ICD get a colored kind tag; a bare scope label carries no prefix.
const LABEL_TAG: Record<HitLabel["kind"], string | null> = {
  scope: null,
  agent: "AGENT",
  icd: "ICD",
};
// One chip shape for all pills (differentiated by accent color, so they read as
// a set): a faint accent-tinted dark fill, an accent border, an accent-colored
// kind tag, and a name. Deliberately quieter than the results themselves.
// Distinct hues per kind — agent warm (--entity-agent), ICD cool
// (--entity-instance, since an ICD defines an instance), scope neutral tan — so
// scope and ICD don't blur together. Only the agent name is bright; scope/ICD
// names sit at --tan-2, dimmer than the adjacent result title.
const LABEL_ACCENT: Record<HitLabel["kind"], string> = {
  scope: "var(--tan-3)",
  icd: "var(--entity-instance)",
  agent: "var(--entity-agent)",
};
const LABEL_NAME: Record<HitLabel["kind"], string> = {
  scope: "var(--tan-2)",
  icd: "var(--tan-2)",
  agent: "var(--tan)",
};

// Hover title: the ICD tag is expanded to its full name so the tooltip adds
// information instead of repeating the pill's own "ICD NAME" text verbatim.
function labelTitle(label: HitLabel): string {
  if (label.kind === "icd") return `Instance Configuration Document for ${label.text}`;
  const tag = LABEL_TAG[label.kind];
  return tag ? `${tag}: ${label.text}` : label.text;
}

function GutterLabel({ label }: { label: HitLabel }) {
  const accent = LABEL_ACCENT[label.kind];
  const tag = LABEL_TAG[label.kind];
  return (
    <span
      className="block text-center text-[10px] leading-tight px-1.5 py-0.5 rounded break-words"
      style={{
        color: LABEL_NAME[label.kind],
        background: `color-mix(in srgb, ${accent} 15%, transparent)`,
        border: `1px solid color-mix(in srgb, ${accent} 55%, transparent)`,
      }}
      title={labelTitle(label)}
    >
      {tag && <span className="mr-1" style={{ color: accent }}>{tag}</span>}
      {label.text}
    </span>
  );
}

export const SearchResult = memo(function SearchResult({ hit, rank, onResultClick }: Props) {
  const color = depthColor(realDepth(hit.doc_no));
  const shortAddress = hit.chainlogAddress ? shortAddr(hit.chainlogAddress) : "";

  const reason = hit.chainlogId ? hit.matchReason.replace(/^chainlog \+ /, "") : hit.matchReason;

  return (
    <div className="search-result relative">
      {/* Per-result selection checkbox — hidden until hover (or when checked),
          top-right like the reader's node checkbox. Adds this doc to the current
          selection. */}
      <SearchResultSelectBox nodeId={hit.id} title={hit.title} />
      {/* Provenance labels — float left on wide screens, inline on narrow */}
      {hit.labels && hit.labels.length > 0 && (
        <div className="lg:absolute lg:right-full lg:mr-3 lg:top-3 lg:w-[140px] lg:p-0 px-4 pt-2 mono flex flex-wrap lg:flex-col items-start lg:items-stretch justify-start gap-1">
          {hit.labels.map((label) => (
            <GutterLabel key={label.kind + label.text} label={label} />
          ))}
        </div>
      )}
      {/* Match info — floats right on wide screens, inline on narrow */}
      <div className="lg:absolute lg:left-full lg:ml-3 lg:top-3 lg:flex-col lg:text-center flex items-center gap-1.5 mono px-4 pt-2 lg:p-0 lg:w-[96px]">
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
