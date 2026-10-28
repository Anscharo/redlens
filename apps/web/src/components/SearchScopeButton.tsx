import { Tooltip } from "./Tooltip";
import { SEARCH_PILL_CLASS, searchPillStyle } from "./searchPill";
import type { ScopeDoc } from "../hooks/useSearchScope";

interface Props {
  /** The document a press scopes to, or null when none has been opened. */
  scopeDoc: ScopeDoc | null;
  /** The doc_no the query is scoped to now, or null. */
  scoped: string | null;
  onToggle: () => void;
}

function scopeTooltip(scopeDoc: ScopeDoc | null, scoped: string | null): string {
  if (scoped && (!scopeDoc || scoped.toUpperCase() === scopeDoc.docNo.toUpperCase())) {
    return `Searching within ${scoped} and children — press to search the whole atlas`;
  }
  if (scopeDoc && scoped) return `Search within ${scopeDoc.docNo} and children instead of ${scoped}`;
  if (scopeDoc) return `Search within ${scopeDoc.docNo} and children (adds in:${scopeDoc.docNo})`;
  return "Open a document to search within it";
}

/** The `in:` button beside the search field: scopes the query to the open document's subtree, or lifts the scope. */
export function SearchScopeButton({ scopeDoc, scoped, onToggle }: Props) {
  const tooltip = scopeTooltip(scopeDoc, scoped);
  return (
    <Tooltip content={tooltip}>
      <span className="flex shrink-0">
        <button
          type="button"
          onClick={onToggle}
          aria-label={tooltip}
          aria-pressed={scoped !== null}
          disabled={!scopeDoc && !scoped}
          className={SEARCH_PILL_CLASS}
          style={searchPillStyle(scoped !== null)}
        >
          in:
        </button>
      </span>
    </Tooltip>
  );
}
