import { memo } from "react";
import { realDepth, type SearchHit } from "../types";

function depthColor(depth: number): string {
  return `var(--depth-${Math.min(Math.max(depth, 1), 17)})`;
}

interface Props {
  hit: SearchHit;
  onNavigate: (id: string) => void;
}

export const SearchResult = memo(function SearchResult({ hit, onNavigate }: Props) {
  const shortAddr = hit.chainlogAddress
    ? `${hit.chainlogAddress.slice(0, 6)}…${hit.chainlogAddress.slice(-4)}`
    : "";

  // Build badge lines: match reason, then chainlog details if present
  const reason = hit.chainlogId
    ? hit.matchReason.replace(/^chainlog \+ /, "")  // drop redundant "chainlog +" prefix
    : hit.matchReason;

  return (
    <div className="relative">
      {/* Match info — floats left on wide screens, inline on narrow */}
      <div
        className="lg:absolute lg:right-full lg:mr-3 lg:top-3 lg:flex-col lg:text-center flex items-center gap-1.5 mono px-4 pt-2 lg:p-0 lg:w-[96px]"
      >
        {hit.chainlogId ? (
          <>
            <span className="text-[9px]" style={{ color: "var(--tan-3)" }}>via chainlog</span>
            <span className="text-[10px] font-medium" style={{ color: "var(--accent)" }}>{hit.chainlogId}</span>
            <span className="text-[9px]" style={{ color: "var(--tan-3)" }}>{shortAddr}</span>
          </>
        ) : (
          <>
            <span className="text-[9px]" style={{ color: "var(--tan-3)" }}>matched</span>
            <span className="text-[10px]" style={{ color: "var(--tan-2)" }}>{reason}</span>
          </>
        )}
      </div>
      <a
        href={`${import.meta.env.BASE_URL}?id=${hit.id}`}
        onClick={(e) => { e.preventDefault(); onNavigate(hit.id); }}
        className="block group px-4 py-3 border-b"
        style={{
          borderColor: "var(--border)",
          textDecoration: "none",
        }}
        onMouseEnter={e => (e.currentTarget.style.background = "var(--hover)")}
        onMouseLeave={e => (e.currentTarget.style.background = "")}
      >
        <h3
          className="text-sm font-semibold mb-1"
          style={{ color: "var(--tan)" }}
          dangerouslySetInnerHTML={{ __html: hit.titleHtml }}
        />
        <div className="flex items-center gap-3 mb-1">
          <span
            className="text-[11px] font-medium px-1.5 py-0.5 rounded mono"
            style={{
              background: "var(--surface)",
              color: depthColor(realDepth(hit.doc_no)),
              border: `1px solid color-mix(in srgb, ${depthColor(realDepth(hit.doc_no))} 40%, transparent)`,
            }}
          >
            {hit.type}
          </span>
          <span className="text-xs mono" style={{ color: "var(--tan-2)" }}>{hit.doc_no}</span>
          <span className="text-[10px] mono" style={{ color: "var(--tan-3)" }}>{hit.id}</span>
        </div>
        {hit.snippet && (
          <p
            className="text-sm leading-snug line-clamp-2"
            style={{ color: "var(--tan-2)" }}
            dangerouslySetInnerHTML={{ __html: hit.snippet }}
          />
        )}
      </a>
    </div>
  );
});
