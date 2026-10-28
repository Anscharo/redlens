import type { RecentSuggestion } from "./recentSearches";

/** How many recent searches the dropdown under the search field shows at most. */
export const MAX_SUGGESTIONS = 6;

/**
 * The recent searches to offer under the field for what is typed. An empty
 * field (or the bare quote pair the phrase/strict pills leave behind) offers
 * them all; otherwise only those the typed text is a prefix of, typeahead
 * style. Both checks ignore case, and the typed search itself is never offered,
 * since picking it would run the search already showing.
 */
export function matchingRecents(recent: RecentSuggestion[], query: string, max = MAX_SUGGESTIONS): RecentSuggestion[] {
  const typed = query.trim().toLowerCase();
  const prefix = typed === '""' || typed === "''" ? "" : typed;
  return recent
    .filter(({ q }) => {
      const ql = q.toLowerCase();
      return ql !== typed && ql.startsWith(prefix);
    })
    .slice(0, max);
}
