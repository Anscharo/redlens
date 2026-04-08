import { memo } from "react";
import type { SearchHit } from "../types";

interface Props {
  hit: SearchHit;
  onNavigate: (id: string) => void;
}

export const SearchResult = memo(function SearchResult({ hit, onNavigate }: Props) {
  return (
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
      >
        {hit.title}
      </h3>
      <div className="flex items-center gap-3 mb-1">
        <span
          className="text-[11px] font-medium px-1.5 py-0.5 rounded mono"
          style={{
            background: "var(--surface)",
            color: "var(--red)",
            border: "1px solid var(--border)",
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
  );
});
