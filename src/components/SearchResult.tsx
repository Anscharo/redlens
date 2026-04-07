import type { SearchHit } from "../types";

interface Props {
  hit: SearchHit;
  onNavigate: (id: string) => void;
}

const TYPE_COLORS: Record<string, string> = {
  Scope: "bg-purple-100 text-purple-800",
  Article: "bg-blue-100 text-blue-800",
  Section: "bg-sky-100 text-sky-800",
  Core: "bg-slate-100 text-slate-700",
  "Action Tenet": "bg-green-100 text-green-800",
  Annotation: "bg-yellow-100 text-yellow-800",
  Scenario: "bg-orange-100 text-orange-800",
  "Scenario Variation": "bg-orange-50 text-orange-700",
  "Active Data": "bg-teal-100 text-teal-800",
  "Active Data Controller": "bg-teal-100 text-teal-800",
  "Type Specification": "bg-indigo-100 text-indigo-800",
  "Needed Research": "bg-red-100 text-red-800",
};

export function SearchResult({ hit, onNavigate }: Props) {
  const typeColor = TYPE_COLORS[hit.type] ?? "bg-slate-100 text-slate-700";

  return (
    <a
      href={`/?id=${hit.id}`}
      onClick={(e) => { e.preventDefault(); onNavigate(hit.id); }}
      className="block group px-4 py-3 hover:bg-slate-50 border-b border-slate-100 last:border-0"
    >
      <h3 className="text-sm font-semibold text-slate-900 group-hover:text-sky-600 mb-1">
        {hit.title}
      </h3>
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${typeColor}`}>
          {hit.type}
        </span>
        <span className="text-xs font-mono text-slate-400">{hit.doc_no}</span>
        <span className="text-[10px] font-mono text-slate-300">{hit.id}</span>
      </div>
      {hit.snippet && (
        <p
          className="text-sm text-slate-500 leading-snug line-clamp-2"
          dangerouslySetInnerHTML={{ __html: hit.snippet }}
        />
      )}
    </a>
  );
}
