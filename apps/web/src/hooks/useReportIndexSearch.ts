import { useEffect, useMemo, useState } from "react";
import { REPORT_INDEX_SECTIONS } from "@/lib/reportCatalog";
import { filterReportSections, normalizeReportIndexQuery } from "@/lib/reportIndexSearch";
import { loadReportIndexEmbedder, scoreReportIndex } from "../lib/reportIndexEmbed";

/**
 * /reports index filter. Lexical matches apply on this render; ternlight
 * scores join in once the wasm chunk is ready for the current query. A
 * load failure stays lexical-only.
 */
export function useReportIndexSearch(query: string) {
  const q = normalizeReportIndexQuery(query);
  const [scored, setScored] = useState<{ q: string; scores: Map<string, number> } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!q) {
      setScored(null);
      return;
    }
    let cancelled = false;
    void loadReportIndexEmbedder().then((emb) => {
      if (cancelled) return;
      if (!emb) {
        setFailed(true);
        return;
      }
      setScored({ q, scores: scoreReportIndex(emb, q) });
    });
    return () => {
      cancelled = true;
    };
  }, [q]);

  const scores = scored?.q === q ? scored.scores : undefined;
  const sections = useMemo(
    () => filterReportSections(REPORT_INDEX_SECTIONS, query, scores),
    [query, scores],
  );
  const pending = q !== "" && sections.length === 0 && scores == null && !failed;
  return { sections, pending };
}
