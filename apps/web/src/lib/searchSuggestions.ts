import type { SearchLane } from "@/lib/searchSemantic";
import type { SearchMode } from "../hooks/useSearchInput";

export function broadSuggestion(query: string, mode: SearchMode, lane: SearchLane): string | null {
  if (lane !== "lexical") return null;
  const nonBroad = mode !== "broad" || query.includes('"') || query.includes("'");
  if (!nonBroad) return null;
  return query.replace(/["']/g, "").replace(/\s+/g, " ").trim() || null;
}
