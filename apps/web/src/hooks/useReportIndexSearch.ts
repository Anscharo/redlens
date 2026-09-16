import { useEffect, useMemo, useState } from "react";
import { REPORT_INDEX_SECTIONS } from "@/lib/reportCatalog";
import {
  filterReportSections,
  normalizeReportIndexQuery,
  type ReportIndexSearchResponse,
} from "@/lib/reportIndexSearch";

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
    void fetch(`/api/reports/search?q=${encodeURIComponent(query.trim())}`, { signal: ac.signal })
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
    return () => ac.abort();
  }, [q, query]);

  const extraIds = scored?.q === q ? scored.hits : undefined;
  const sections = useMemo(
    () => filterReportSections(REPORT_INDEX_SECTIONS, query, extraIds),
    [query, extraIds],
  );
  const pending = q !== "" && sections.length === 0 && extraIds == null && !failed;
  return { sections, pending };
}
