import { useEffect, useMemo, useState } from "react";
import { REPORT_INDEX_GROUPS } from "@/lib/reportCatalog";
import {
  filterReportGroups,
  normalizeReportIndexQuery,
  type ReportIndexSearchResponse,
} from "@/lib/reportIndexSearch";

/** Pause before the semantic round-trip so typing doesn't embed every prefix. Lexical filtering stays sync. */
export const REPORT_INDEX_SEARCH_DEBOUNCE_MS = 200;

/**
 * /reports index filter. Lexical matches apply on this render; semantic
 * hits from GET /api/reports/search join in once that round-trip lands.
 * A load failure stays lexical-only.
 */
export function useReportIndexSearch(query: string) {
  const q = normalizeReportIndexQuery(query);
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
  const groups = useMemo(
    () => filterReportGroups(REPORT_INDEX_GROUPS, q, extraIds),
    [q, extraIds],
  );
  const pending = q !== "" && groups.length === 0 && extraIds == null && !failed;
  return { groups, pending };
}
