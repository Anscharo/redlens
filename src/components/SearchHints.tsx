import type { ReportId } from "../App";

const HINTS: { label: string; query: string; description: string }[] = [
  { label: "wildcard",           query: "govern*",                     description: "Trailing * matches any suffix" },
  { label: "0x address",         query: "0x*",                        description: "All nodes containing an Ethereum address" },
  { label: "chainlog id",        query: "MCD_VAT",                    description: "All nodes referencing a Sky chainlog contract" },
  { label: "doc number",         query: "A.1.2",                      description: "Jump directly to a section by number" },
  { label: "field: title",       query: "title:facilitator",          description: "Search only in the title field" },
  { label: "field: type",        query: "type:Annotation",            description: "Filter by node type" },
  { label: "fuzzy match",        query: "misaligment~1",              description: "~N allows N character edits" },
  { label: "boost term",         query: "delegate^5 voting",          description: "^N boosts a term's relevance weight" },
  { label: "exclude term",       query: "alignment -slippery",        description: "Prefix with - to exclude a term" },
  { label: "combine fields",     query: "type:Core title:quorum",     description: "Mix field filters and free text" },
];

const REPORTS: { id: ReportId; label: string; description: string }[] = [
  { id: "of-responsibilities", label: "OF responsibilities", description: "Every Atlas section mandating action from an Operational Facilitator" },
  { id: "active-data",         label: "Active Data index",   description: "All Active Data sections, editors, and processes — with CSV export" },
];

export function SearchHints({ onSearch, onReport }: { onSearch: (q: string) => void; onReport: (id: ReportId) => void }) {
  return (
    <div className="px-4 py-8 max-w-2xl mx-auto">
      <p className="text-xs mono mb-6 text-tan-3">search patterns</p>
      <div className="space-y-1 mb-8">
        {HINTS.map((h) => (
          <button
            key={h.query}
            onClick={() => onSearch(h.query)}
            className="hint-row w-full text-left flex items-baseline gap-4 px-3 py-2 rounded"
          >
            <span className="mono text-xs shrink-0 w-32 text-tan-3">{h.label}</span>
            <span className="mono text-sm shrink-0 text-accent">{h.query}</span>
            <span className="text-xs hidden sm:block text-tan-3">{h.description}</span>
          </button>
        ))}
      </div>
      <p className="text-xs mono mb-3 text-tan-3">reports</p>
      <div className="space-y-1">
        {REPORTS.map((r) => (
          <button
            key={r.id}
            onClick={() => onReport(r.id)}
            className="hint-row w-full text-left flex items-baseline gap-4 px-3 py-2 rounded"
          >
            <span className="mono text-xs shrink-0 w-32 text-tan-3">report</span>
            <span className="text-sm shrink-0 text-accent">{r.label}</span>
            <span className="text-xs hidden sm:block text-tan-3">{r.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
