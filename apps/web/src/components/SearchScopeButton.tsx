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

/** True when a press lifts the scope: it is the open document's, or no document is open to switch to. */
function liftsScope(scopeDoc: ScopeDoc | null, scoped: string | null): boolean {
  return scoped !== null && (!scopeDoc || scoped.toUpperCase() === scopeDoc.docNo.toUpperCase());
}

function scopeTooltip(scopeDoc: ScopeDoc | null, scoped: string | null): string {
  if (scoped && liftsScope(scopeDoc, scoped)) {
    return `Searching within ${scoped} and children — press to search the whole atlas`;
  }
  if (scopeDoc && scoped) return `Search within ${scopeDoc.docNo} and children instead of ${scoped}`;
  if (scopeDoc) return `Search within ${scopeDoc.docNo} and children (adds in:${scopeDoc.docNo})`;
  return "Open a document to search within it";
}

/** The `in:` button beside the search field: scopes the query to the open document's subtree, or lifts the scope. */
export function SearchScopeButton({ scopeDoc, scoped, onToggle }: Props) {
  const tooltip = scopeTooltip(scopeDoc, scoped);
  // Lit only when a press would lift the scope; a scope to some other document
  // reads as unpressed, since a press switches it rather than turning it off.
  const pressed = liftsScope(scopeDoc, scoped);
  return (
    <Tooltip content={tooltip}>
      <span className="flex shrink-0">
        <button
          type="button"
          onClick={onToggle}
          aria-label={tooltip}
          aria-pressed={pressed}
          disabled={!scopeDoc && !scoped}
          className={SEARCH_PILL_CLASS}
          style={searchPillStyle(pressed)}
        >
          in:
        </button>
      </span>
    </Tooltip>
  );
}
