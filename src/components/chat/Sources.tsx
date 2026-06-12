import { useEffect, useState } from "react";
import { loadAtlas } from "../../lib/docs";
import type { Source } from "./markdown";

// Sources cluster: one chip per cited atlas doc. The agent only emits title +
// UUID in links, so we resolve the editorial doc_no from the cached docs.json
// (loadAtlas is memoised) to render the mono doc-no + serif title chip.
export function Sources({ sources, onAtlas }: { sources: Source[]; onAtlas: (uuid: string) => void }) {
  const [docNos, setDocNos] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    if (!sources.length) return;
    loadAtlas()
      .then((b) => {
        if (!alive) return;
        const map: Record<string, string> = {};
        for (const s of sources) {
          const n = b.docs[s.uuid];
          if (n) map[s.uuid] = n.doc_no;
        }
        setDocNos(map);
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
        {sources.map((s) => (
          <a
            key={s.uuid}
            className="rlc-cite"
            href={`/atlas?id=${s.uuid}`}
            onClick={(e) => {
              e.preventDefault();
              onAtlas(s.uuid);
            }}
          >
            {docNos[s.uuid] && <span className="rlc-cite-doc">{docNos[s.uuid]}</span>}
            <span className="rlc-cite-title">{s.title}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
