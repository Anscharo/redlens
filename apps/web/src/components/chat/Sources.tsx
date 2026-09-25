import { useEffect, useRef, useState } from "react";
import { loadAtlas } from "../../lib/docs";
import { atlasHref } from "@/lib/routes";
import { track } from "../../lib/analytics";
import { Tooltip } from "../Tooltip";
import type { Source } from "./markdown";
import type { CitationMark } from "./api";
import { showClaimInAnswer } from "./claimHighlight";
import { SourceMark, sourceTooltipContent } from "./SourceMark";

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
export function Sources({
  sources,
  marks,
  onAtlas,
}: {
  sources: Source[];
  // Per-doc citation-check verdicts, keyed by uuid (server: `citation_marks`).
  // Optional/absent means the check never landed for this turn — every chip
  // renders unmarked, same as a doc uuid missing from a marks map that did
  // arrive.
  marks?: Record<string, CitationMark>;
  onAtlas: (uuid: string) => void;
}) {
  const [resolved, setResolved] = useState<Record<string, ResolvedDoc>>({});
  const anchors = useRef(new Map<string, HTMLElement>());

  function showClaim(uuid: string, claim: string) {
    const answer = anchors.current.get(uuid)?.closest(".rlc-turn")?.querySelector(".rlc-answer");
    if (answer instanceof HTMLElement) showClaimInAnswer(answer, claim);
  }

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
          const mark = marks?.[s.uuid];
          // The whole pill is the hover target, not the glyph. Tooltip
          // renders the child alone when there is nothing to say.
          return (
            <Tooltip key={s.uuid} content={sourceTooltipContent(mark, (claim) => showClaim(s.uuid, claim))}>
              <a
                className="rlc-cite"
                ref={(node) => {
                  if (node) anchors.current.set(s.uuid, node);
                  else anchors.current.delete(s.uuid);
                }}
                href={atlasHref(s.uuid)}
                onClick={(e) => {
                  e.preventDefault();
                  track("chat_citation_click", { product: "chat", node_id: s.uuid });
                  onAtlas(s.uuid);
                }}
              >
                {r?.docNo && <span className="rlc-cite-doc">{r.docNo}</span>}
                <span className="rlc-cite-title">{r?.title ?? s.title}</span>
                <SourceMark mark={mark} />
              </a>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
