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

/**
 * The hover text. The document a press scopes to is named by its title; a
 * scope the query arrived with and no open document to name it is left as its
 * doc_no, which is all the query carries.
 */
function scopeTooltip(scopeDoc: ScopeDoc | null, scoped: string | null): string {
  if (scoped && liftsScope(scopeDoc, scoped)) {
    return `Searching within ${scopeDoc?.title ?? scoped} and children — press to search the whole atlas`;
  }
  if (scopeDoc && scoped) return `Search within ${scopeDoc.title} and children instead of ${scoped}`;
  if (scopeDoc) return `Search within ${scopeDoc.title} and children (adds in:${scopeDoc.docNo})`;
  return "Open a document to search within it";
}

/**
 * The `in:` button beside the search field: scopes the query to the open
 * document's subtree, or lifts the scope. From `sm` up it also shows the doc_no
 * it acts on, starred for "and everything under it" (`in:A.1.2*`); phones show
 * `in:` alone.
 */
export function SearchScopeButton({ scopeDoc, scoped, onToggle }: Props) {
  const tooltip = scopeTooltip(scopeDoc, scoped);
  // Lit only when a press would lift the scope; a scope to some other document
  // reads as unpressed, since a press switches it rather than turning it off.
  const pressed = liftsScope(scopeDoc, scoped);
  const target = pressed ? scoped : (scopeDoc?.docNo ?? null);
  // The name opens with the label as wide screens show it, which holds the
  // phone's "in:" too, so a voice-control user can say either; the hover text
  // follows it and never repeats it.
  const label = target ? `in:${target}*` : "in:";
  return (
    <Tooltip content={tooltip}>
      <span className="flex shrink-0">
        <button
          type="button"
          onClick={onToggle}
          aria-label={`${label} ${tooltip}`}
          aria-pressed={pressed}
          disabled={!scopeDoc && !scoped}
          className={`${SEARCH_PILL_CLASS} sm:w-auto sm:px-2 whitespace-nowrap`}
          style={searchPillStyle(pressed)}
        >
          in:
          {target && <span className="hidden sm:inline-block max-w-[9rem] truncate">{target}*</span>}
        </button>
      </span>
    </Tooltip>
  );
}
