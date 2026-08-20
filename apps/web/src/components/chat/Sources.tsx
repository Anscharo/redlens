import { useEffect, useState } from "react";
import { loadAtlas } from "../../lib/docs";
import { atlasHref } from "@/lib/routes";
import { track } from "../../lib/analytics";
import type { Source } from "./markdown";

interface ResolvedDoc {
  docNo: string;
  title: string;
}

// Sources cluster: one chip per cited atlas doc. Link text is no longer
// trustworthy as a title — reference-style citations make it free (a value,
// a quoted phrase, a date, an address) — so we resolve both the editorial
// doc_no *and* the real title from the cached docs.json (loadAtlas is
// memoised), falling back to the link text only when the uuid isn't in the
// bundle.
export function Sources({ sources, onAtlas }: { sources: Source[]; onAtlas: (uuid: string) => void }) {
  const [resolved, setResolved] = useState<Record<string, ResolvedDoc>>({});

  useEffect(() => {
    let alive = true;
    if (!sources.length) return;
    loadAtlas()
      .then((b) => {
        if (!alive) return;
        const map: Record<string, ResolvedDoc> = {};
        for (const s of sources) {
          const n = b.docs[s.uuid];
          if (n) map[s.uuid] = { docNo: n.doc_no, title: n.title };
        }
        setResolved(map);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [sources]);

  if (!sources.length) return null;
  return (
    <div className="rlc-sources">
      <p className="rlc-sources-label">sources · {sources.length}</p>
      <div className="rlc-sources-chips">
        {sources.map((s) => {
          const r = resolved[s.uuid];
          return (
            <a
              key={s.uuid}
              className="rlc-cite"
              href={atlasHref(s.uuid)}
              onClick={(e) => {
                e.preventDefault();
                track("chat_citation_click", { product: "chat", node_id: s.uuid });
                onAtlas(s.uuid);
              }}
            >
              {r?.docNo && <span className="rlc-cite-doc">{r.docNo}</span>}
              <span className="rlc-cite-title">{r?.title ?? s.title}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
