import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { SLASH_COMMANDS } from "../lib/shortcuts";

const HINTS: { label: string; query: string; description: string }[] = [
  {
    label: "broad",
    query: "govern",
    description: "Default mode — partial words match automatically, case-insensitive",
  },
  {
    label: "singular/plural",
    query: "subsidy",
    description: "Broad mode also matches the other number (subsidies); exact wording ranks first",
  },
  {
    label: "phrase",
    query: '"properly implemented"',
    description: "Double quotes — whole-word phrase match, case-insensitive",
  },
  {
    label: "strict",
    query: "'delegatedSigners'",
    description: "Single quotes — whole-word phrase match, case-sensitive",
  },
  { label: "fuzzy", query: "misaligment~1", description: "~N allows N character edits" },
  { label: "0x address", query: "0xbe8e3e", description: "All nodes containing matched Ethereum address" },
  {
    label: "chainlog id",
    query: "MCD_VAT",
    description: "All nodes referencing a Sky chainlog contract",
  },
  { label: "doc number", query: "A.1.2", description: "Jump directly to a section by number" },
  {
    label: "uuid",
    query: "a491d7d0",
    description: "Jump to a doc by UUID — the full id, or a partial prefix (8+ hex)",
  },
  {
    label: "field: title",
    query: "title:facilitator",
    description: "Search only in the title field",
  },
  { label: "field: type", query: "type:Annotation", description: "Filter by node type" },
  {
    label: "type (spaces)",
    query: "type:Scenario_Variation",
    description: 'Underscore for multi-word types, or quote: type:"Scenario Variation"',
  },
  {
    label: "scope",
    query: "in:A.1.2 delegate",
    description: "Restrict results to a section subtree",
  },
  {
    label: "exclude term",
    query: "alignment -slippery",
    description: "Prefix with - to exclude a term",
  },
  {
    label: "combine fields",
    query: "type:Core title:quorum",
    description: "Mix field filters and broad terms",
  },
  {
    label: "scope + type + phrase",
    query: 'in:A.1 type:Core "alignment requirement"',
    description: "Restrict to a section subtree, filter by node type, match an exact phrase",
  },
  {
    label: "field + type + exclude",
    query: "title:facilitator type:Core -operational",
    description: "Search within the title field, filter by type, and drop an unwanted term",
  },
];

export function SearchHintsPage({ onHintClick }: { onHintClick: (q: string) => void }) {
  useDocumentTitle("Search Hints: Sky Atlas by Redline");
  return (
    <main className="flex-1 overflow-y-auto">
      <SearchHints onSearch={onHintClick} />
    </main>
  );
}

export function SearchHints({
  onSearch,
  slashFilter,
}: {
  onSearch: (q: string) => void;
  slashFilter?: string | null;
}) {
  if (slashFilter !== null && slashFilter !== undefined) {
    const matches = SLASH_COMMANDS.filter((s) => s.cmd.startsWith(slashFilter));
    return (
      <div className="px-4 py-8 max-w-4xl mx-auto">
        <p className="text-xs mono mb-3 text-tan-3">shortcuts</p>
        <div className="space-y-1">
          {matches.length > 0 ? (
            matches.map((s) => (
              <button
                key={s.cmd}
                onClick={() => onSearch(s.cmd)}
                className="hint-row w-full text-left flex items-baseline gap-4 px-3 py-2 rounded"
              >
                <span className="mono text-sm shrink-0 text-accent">{s.cmd}</span>
                <span className="text-xs text-tan-3">{s.description}</span>
              </button>
            ))
          ) : (
            <p className="text-xs mono text-tan-3 px-3">no matching slash commands</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-8 max-w-4xl mx-auto">
      <table className="w-full text-xs border-collapse mb-8">
        <thead>
          <tr className="text-left">
            <th className="mono text-tan-3 font-normal pb-3 pr-6">Feature</th>
            <th className="mono text-tan-3 font-normal pb-3 pr-6">Example</th>
            <th className="mono text-tan-3 font-normal pb-3 hidden sm:table-cell">Explanation</th>
          </tr>
        </thead>
        <tbody>
          {HINTS.map((h) => (
            <tr
              key={h.query}
              onClick={() => onSearch(h.query)}
              className="hint-row cursor-pointer even:bg-[var(--surface)]"
            >
              <td className="mono text-tan-3 pr-6 py-1.5 whitespace-nowrap">{h.label}</td>
              <td className="mono text-accent pr-6 py-1.5 whitespace-nowrap">{h.query}</td>
              <td className="text-tan-3 py-1.5 hidden sm:table-cell">{h.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
