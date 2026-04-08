const HINTS: { label: string; query: string; description: string }[] = [
  { label: "exact phrase",       query: '"alignment engineering"',     description: "Wrap in quotes for exact phrases" },
  { label: "wildcard",           query: "govern*",                     description: "Trailing * matches any suffix" },
  { label: "0x address",         query: "0x*",                        description: "All nodes containing an Ethereum address" },
  { label: "doc number",         query: "A.1.2",                      description: "Jump directly to a section by number" },
  { label: "field: title",       query: "title:facilitator",          description: "Search only in the title field" },
  { label: "field: type",        query: "type:Annotation",            description: "Filter by node type" },
  { label: "fuzzy match",        query: "misaligment~1",              description: "~N allows N character edits" },
  { label: "boost term",         query: "delegate^5 voting",          description: "^N boosts a term's relevance weight" },
  { label: "exclude term",       query: "alignment -slippery",        description: "Prefix with - to exclude a term" },
  { label: "combine fields",     query: "type:Core title:quorum",     description: "Mix field filters and free text" },
];

export function SearchHints({ onSearch }: { onSearch: (q: string) => void }) {
  return (
    <div className="px-4 py-8 max-w-2xl mx-auto">
      <p className="text-xs mono mb-6" style={{ color: "var(--tan-3)" }}>search patterns</p>
      <div className="space-y-1">
        {HINTS.map((h) => (
          <button
            key={h.query}
            onClick={() => onSearch(h.query)}
            className="w-full text-left flex items-baseline gap-4 px-3 py-2 rounded"
            style={{ background: "transparent" }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--hover)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            <span className="mono text-xs shrink-0 w-32" style={{ color: "var(--tan-3)" }}>
              {h.label}
            </span>
            <span className="mono text-sm shrink-0" style={{ color: "var(--accent)" }}>
              {h.query}
            </span>
            <span className="text-xs hidden sm:block" style={{ color: "var(--tan-3)" }}>
              {h.description}
            </span>
          </button>
        ))}
      </div>

    </div>
  );
}
