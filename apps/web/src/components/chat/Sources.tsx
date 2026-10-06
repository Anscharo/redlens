import { useRef } from "react";
import { atlasHref } from "@/lib/routes";
import { track } from "../../lib/analytics";
import { Tooltip } from "../Tooltip";
import type { Source } from "./markdown";
import type { CitationMark } from "./api";
import { showClaimInAnswer } from "./claimHighlight";
import { SourceMark, sourceTooltipContent } from "./SourceMark";
import { useResolvedDocs, type ResolvedDoc } from "./useResolvedDocs";

export interface SourceChipProps {
  source: Source;
  /** The resolved doc_no + title, when the uuid is in the bundle. */
  resolved?: ResolvedDoc;
  /** This doc's citation-check verdict, if any. */
  mark?: CitationMark;
  /** Records the chip's anchor so a claim can be found in its turn's answer. */
  anchorRef: (node: HTMLAnchorElement | null) => void;
  /** Scrolls the quoted claim into view in the answer and flashes it. */
  onShowClaim: (claim: string) => void;
  onAtlas: (uuid: string) => void;
}

// One cited doc. The whole pill is the hover target, not the glyph; Tooltip
// renders the child alone when there is nothing to say.
function SourceChip({ source: s, resolved: r, mark, anchorRef, onShowClaim, onAtlas }: SourceChipProps) {
  return (
    <Tooltip content={sourceTooltipContent(mark, onShowClaim)}>
      <a
        className="rlc-cite"
        ref={anchorRef}
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
}

/** How a turn's citations open as the conversation's collection. */
export interface CollectionLink {
  onView: () => void;
  /** The last attempt to open it failed. */
  failed: boolean;
}

function ViewCollection({ link }: { link: CollectionLink }) {
  return (
    <>
      <span aria-hidden="true"> — </span>
      <button type="button" className="rlc-sources-link" onClick={link.onView}>
        view in collection
      </button>
      {link.failed && <span role="alert"> (couldn’t open)</span>}
    </>
  );
}

export interface SourcesProps {
  sources: Source[];
  // Per-doc citation-check verdicts, keyed by uuid (server: `citation_marks`).
  // Optional/absent means the check never landed for this turn — every chip
  // renders unmarked, same as a doc uuid missing from a marks map that did
  // arrive.
  marks?: Record<string, CitationMark>;
  /** Present once the conversation has an id to read its collection from. */
  collection?: CollectionLink;
  onAtlas: (uuid: string) => void;
}

// Sources cluster: one chip per cited atlas doc. Link text is not trustworthy
// as a title — reference-style citations make it free (a value, a quoted
// phrase, a date, an address) — so both the editorial doc_no *and* the real
// title are resolved from docs.json (useResolvedDocs), falling back to the
// link text only when the uuid isn't in the bundle.
export function Sources({ sources, marks, collection, onAtlas }: SourcesProps) {
  const resolved = useResolvedDocs(sources);
  const anchors = useRef(new Map<string, HTMLElement>());
  const showClaim = (uuid: string, claim: string) => {
    const answer = anchors.current.get(uuid)?.closest(".rlc-turn")?.querySelector(".rlc-answer");
    if (answer instanceof HTMLElement) showClaimInAnswer(answer, claim);
  };
  if (!sources.length) return null;
  return (
    <div className="rlc-sources">
      <p className="rlc-sources-label">
        <span>citations · {sources.length}</span>
        {collection && <ViewCollection link={collection} />}
      </p>
      <div className="rlc-sources-chips">
        {sources.map((s) => (
          <SourceChip
            key={s.uuid}
            source={s}
            resolved={resolved[s.uuid]}
            mark={marks?.[s.uuid]}
            anchorRef={(node) => {
              if (node) anchors.current.set(s.uuid, node);
              else anchors.current.delete(s.uuid);
            }}
            onShowClaim={(claim) => showClaim(s.uuid, claim)}
            onAtlas={onAtlas}
          />
        ))}
      </div>
    </div>
  );
}
