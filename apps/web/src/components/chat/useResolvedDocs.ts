import { useEffect, useState } from "react";
import { loadAtlas } from "../../lib/docs";
import type { Source } from "./markdown";

export interface ResolvedDoc {
  docNo: string;
  title: string;
}

function resolveDocs(sources: Source[], docs: Record<string, { doc_no: string; title: string }>): Record<string, ResolvedDoc> {
  const map: Record<string, ResolvedDoc> = {};
  for (const s of sources) {
    const n = docs[s.uuid];
    if (n) map[s.uuid] = { docNo: n.doc_no, title: n.title };
  }
  return map;
}

// The editorial doc_no and the real title of each cited doc, from the cached
// docs.json (loadAtlas is memoised), keyed by uuid. A uuid missing from the
// bundle is simply absent; a load failure leaves the map empty.
export function useResolvedDocs(sources: Source[]): Record<string, ResolvedDoc> {
  const [resolved, setResolved] = useState<Record<string, ResolvedDoc>>({});
  useEffect(() => {
    let alive = true;
    if (!sources.length) return;
    loadAtlas()
      .then((b) => alive && setResolved(resolveDocs(sources, b.docs)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [sources]);
  return resolved;
}
