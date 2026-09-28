import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { SLASH_COMMANDS } from "../lib/shortcuts";
import { HINT_GROUPS } from "../lib/searchHintsData";

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
        {HINT_GROUPS.map((g, gi) => (
          // One tbody per group with scope="rowgroup": these headings label the
          // ROWS that follow, not a group of columns. Separate tbodies also give
          // the stripe back to CSS nth-child, so the rows carry no index math.
          <tbody key={g.title}>
            <tr>
              <th
                scope="rowgroup"
                colSpan={3}
                className={`text-left font-normal pb-2 ${gi === 0 ? "" : "pt-7"}`}
              >
                <div className="flex flex-wrap items-baseline gap-x-3 pb-1 border-b border-[var(--border)]">
                  <span className="mono uppercase tracking-wider text-tan">{g.title}</span>
                  {g.note && <span className="text-tan-3">{g.note}</span>}
                </div>
              </th>
            </tr>
            {g.hints.map((h) => (
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
        ))}
      </table>
    </div>
  );
}
