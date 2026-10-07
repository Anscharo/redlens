// Pure search-mode text logic: how the broad / phrase / strict pills read and
// rewrite the query text. No React, no URL state.

export type SearchMode = "broad" | "phrase" | "strict";

export const SEARCH_MODES: readonly SearchMode[] = ["broad", "phrase", "strict"];

// Strips field:value tokens and -exclusions, leaving only the free search text.
function stripFieldTokens(q: string): string {
  return q
    .replace(/\b\w+:(?:"[^"]*"|'[^']*'|\S+)/g, " ")
    .replace(/(?:^|\s)-\w+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Mode inferred from what's actually visible in the query (ignores field tokens).
export function effectiveMode(q: string): SearchMode {
  const bare = stripFieldTokens(q);
  if (bare.length >= 2 && bare.startsWith('"') && bare.endsWith('"')) return "phrase";
  if (bare.length >= 2 && bare.startsWith("'") && bare.endsWith("'")) return "strict";
  return "broad";
}

// True when the user has manually placed partial/mixed quotes in the free text.
export function isMixedQuotes(q: string): boolean {
  const bare = stripFieldTokens(q);
  if (!bare.includes('"') && !bare.includes("'")) return false;
  return effectiveMode(q) === "broad"; // has quotes but not a clean full wrap
}

// Removes clean mode-wrapping from free text while preserving field tokens.
function stripModeWrap(q: string): string {
  const mode = effectiveMode(q);
  if (mode === "broad") return q;
  const re = mode === "phrase" ? /(?<![:\w])"([^"]*)"/g : /(?<![:\w])'([^']*)'/g;
  return q.replace(re, "$1").replace(/\s+/g, " ").trim();
}

// Regex that matches a complete field token (including quoted multi-word values),
// exclusions, and + prefixed terms — used by applyMode and stripModeWrap.
const FIELD_TOKEN_RE = /\b\w+:(?:"[^"]*"|'[^']*'|\S+)|-\w+|\+\w+/g;

// Applies mode wrapping to the bare text portion only (field tokens pass through).
// Checks only the FREE text for existing quotes — quotes inside field:value tokens
// (e.g. type:"Type Specification") are not treated as user-typed mode syntax.
export function applyMode(query: string, mode: SearchMode): string {
  if (mode === "broad") return query;

  const freeText = stripFieldTokens(query);
  if (!freeText.trim()) return query;
  if (freeText.includes('"') || freeText.includes("'") || /~\d/.test(freeText)) return query;

  const wrapper = mode === "phrase" ? '"' : "'";
  const wrapped = `${wrapper}${freeText}${wrapper}`;

  const fieldTokens: string[] = [];
  query.replace(FIELD_TOKEN_RE, (m) => { fieldTokens.push(m); return ""; });

  return fieldTokens.length > 0 ? `${fieldTokens.join(" ")} ${wrapped}` : wrapped;
}

/**
 * The query text and cursor position a mode pill click produces.
 *
 * Pure, so the wrap/unwrap arithmetic is testable without a hook: clicking the
 * active pill (or `broad`) unwraps to the bare text, and clicking another wraps
 * it — inserting an empty quote pair when there is no free text to wrap, so the
 * reader can type inside it.
 */
export function modePillClick(
  query: string,
  mode: SearchMode,
  newMode: SearchMode,
): { newQuery: string; cursorPos: number } {
  const currEffMode = effectiveMode(query);
  const mixed = isMixedQuotes(query);
  const currMode = !mixed && currEffMode !== "broad" ? currEffMode : mode;
  const bareQuery = currEffMode !== "broad" ? stripModeWrap(query) : query;

  if (newMode === "broad" || newMode === currMode) return { newQuery: bareQuery, cursorPos: bareQuery.length };

  const wrapped = applyMode(bareQuery, newMode);
  if (wrapped !== bareQuery) return { newQuery: wrapped, cursorPos: wrapped.length - 1 }; // before the closing quote
  const pair = newMode === "phrase" ? '""' : "''";
  const newQuery = bareQuery.trim() ? `${bareQuery.trim()} ${pair}` : pair;
  return { newQuery, cursorPos: newQuery.length - 1 }; // between the quotes
}
