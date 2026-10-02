import { useEffect, useMemo, useState } from "react";
import { REPORT_INDEX_GROUPS } from "@/lib/reportCatalog";
import {
  cardIdsIn,
  filterReportGroups,
  groupsForIds,
  normalizeReportIndexQuery,
  type ReportIndexSearchResponse,
} from "@/lib/reportIndexSearch";

/** Pause before the semantic round-trip so typing doesn't embed every prefix. Lexical filtering stays sync. */
export const REPORT_INDEX_SEARCH_DEBOUNCE_MS = 200;

/**
 * /reports index filter. Lexical matches apply on this render; semantic
 * hits from GET /api/reports/search always join in as a separate set, so a
 * paraphrase that shares a title word still shows its meaning-only extras
 * under Closest meaning instead of disappearing into the wording lane.
 * A load failure stays lexical-only.
 */
export function useReportIndexSearch(query: string) {
  const q = normalizeReportIndexQuery(query);
  const wording = useMemo(() => filterReportGroups(REPORT_INDEX_GROUPS, q), [q]);
  const [scored, setScored] = useState<{ q: string; hits: ReadonlySet<string> } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!q) {
      setScored(null);
      setFailed(false);
      return;
    }
    setFailed(false);
    const ac = new AbortController();
    const timer = setTimeout(() => {
      void fetch(`/api/reports/search?q=${encodeURIComponent(q)}`, { signal: ac.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(`reports-search: ${res.status}`);
          return res.json() as Promise<ReportIndexSearchResponse>;
        })
        .then((body) => {
          if (ac.signal.aborted) return;
          const hits = Array.isArray(body.hits) ? body.hits : [];
          setScored({ q, hits: new Set(hits) });
        })
        .catch((err: unknown) => {
          if (ac.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
          setFailed(true);
        });
    }, REPORT_INDEX_SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [q]);

  const extraIds = scored?.q === q ? scored.hits : undefined;
  const meaning = useMemo(() => {
    if (!extraIds || extraIds.size === 0) return [];
    const wordingIds = cardIdsIn(wording);
    const extraOnly = new Set([...extraIds].filter((id) => !wordingIds.has(id)));
    return groupsForIds(REPORT_INDEX_GROUPS, extraOnly);
  }, [extraIds, wording]);

  const pending = q !== "" && wording.length === 0 && extraIds == null && !failed;
  const byMeaning = meaning.length > 0;
  return { wording, meaning, pending, byMeaning };
}
