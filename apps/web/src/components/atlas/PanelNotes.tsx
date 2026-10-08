import { useCallback } from "react";
import type { AtlasNode } from "@/types";
import type { CousinDoc } from "../../lib/cousins";
import type { EdgeResult } from "../../lib/graph";
import { RelatedNode } from "../RelatedNode";
import { SECTION_HEAD, type PanelRelation } from "./panelSections";

type Nav = (kind: string, target: string) => void;

interface PanelNotesProps {
  id: string;
  annotationDocs: AtlasNode[];
  linkedNodes: AtlasNode[];
  cousinDocs: CousinDoc[];
  citedBy: EdgeResult["inbound"];
  relations: PanelRelation[];
  onNav: Nav;
  onNavDoc: Nav;
  selectable?: boolean;
  byParent?: Map<string | null, AtlasNode[]>;
}

// The right panel's notes section: the doc's Element Annotations, the documents
// it links to, its cousins under the other Prime Agents, what cites it, and its
// extracted relations. Each list is omitted when empty.
export function PanelNotes(props: PanelNotesProps) {
  const { annotationDocs, linkedNodes, cousinDocs, citedBy, relations, onNav, selectable, byParent } = props;
  // RelatedNode is memoized, so each list gets a stable, kind-tagged callback.
  const navLinked = useCallback((nid: string) => onNav("linked_doc", nid), [onNav]);
  const navCousin = useCallback((nid: string) => onNav("cousin_doc", nid), [onNav]);
  const navAnnotation = useCallback((nid: string) => onNav("annotation_doc", nid), [onNav]);
  return (
    <>
      {/* Element Annotations — this document's OWN Annotation-type children
          (`<doc_no>.0.3.N`), the hardest to reach in the reader, so they lead. */}
      {annotationDocs.length > 0 ? (
        <section className="mb-8 pb-5 border-b border-border">
          <p className={`${SECTION_HEAD} mb-2`}>annotated by · {annotationDocs.length}</p>
          <p className="text-xs leading-relaxed mb-4 text-tan-3">Element Annotations attached to this document.</p>
          <div className="flex flex-col gap-[10px]">
            {annotationDocs.map((node) => (
              <RelatedNode key={node.id} node={node} onNavigate={navAnnotation} selectable={selectable} byParent={byParent} />
            ))}
          </div>
        </section>
      ) : null}
      {linkedNodes.length > 0 ? (
        <section>
          <p className={`${SECTION_HEAD} mb-4`}>linked documents · {linkedNodes.length}</p>
          {linkedNodes.map((node) => (
            <RelatedNode key={node.id} node={node} onNavigate={navLinked} selectable={selectable} byParent={byParent} />
          ))}
        </section>
      ) : null}

      {cousinDocs.length > 0 ? (
        <section className="mt-8 pt-5 border-t border-border">
          <p className={`${SECTION_HEAD} mb-2`}>cousin documents · {cousinDocs.length}</p>
          <p className="text-xs leading-relaxed mb-4 text-tan-3">Equivalent documents under the other Prime Agents.</p>
          <div className="flex flex-col gap-[10px]">
            {cousinDocs.map(({ node, agent }) => (
              <RelatedNode key={node.id} node={node} eyebrow={<span className="atlas-agent-pill">{agent}</span>} onNavigate={navCousin} selectable={selectable} byParent={byParent} />
            ))}
          </div>
        </section>
      ) : null}

      {citedBy.length > 0 && (
        <div className="mt-8">
          <p className={`${SECTION_HEAD} mb-3`}>cited by · {citedBy.length}</p>
          <div className="space-y-1">
            {citedBy.map((e, i) => (
              <button
                key={i}
                className="w-full text-left px-2 py-1.5 rounded text-xs mono hover:bg-hover transition-colors text-accent hover:underline"
                onClick={() => onNav("cited_by", e.f)}
              >
                {e.s?.[0] ?? e.f.slice(0, 8)}
              </button>
            ))}
          </div>
        </div>
      )}

      {relations.length > 0 && <RelationsList {...props} />}
    </>
  );
}

// The header counts every relation; rows pointing back at this doc are dropped.
function RelationsList({ id, relations, onNav, onNavDoc }: Pick<PanelNotesProps, "id" | "relations" | "onNav" | "onNavDoc">) {
  const shown = relations.filter(({ edge, isOut }) => {
    const did = isOut ? edge.to_did : edge.from_did;
    return did !== id && (isOut ? edge.t : edge.f) !== id;
  });
  return (
    <div className="mt-8">
      <p className={`${SECTION_HEAD} mb-3`}>relations · {relations.length}</p>
      <div className="space-y-2">
        {shown.map(({ edge: e, isOut }, i) => {
          const otherId = (isOut ? e.t : e.f) ?? "";
          const otherType = isOut ? e.tt : e.ft;
          const otherLabel = isOut
            ? (e.to_label ?? otherId.slice(0, 8))
            : (e.from_label ?? otherId.slice(0, 8));
          const otherNavId = otherType === "doc"
            ? otherId
            : (isOut ? e.to_did : e.from_did) ?? null;
          return (
            <div key={i} className="text-xs pb-2 border-b border-border">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="mono px-1.5 py-0.5 rounded text-[10px] bg-surface text-accent">{e.e}</span>
                {!isOut && <span className="text-[10px] mono text-gray">←</span>}
                {otherNavId ? (
                  <button className="mono hover:underline text-left text-tan-2" onClick={() => onNav("relation", otherNavId)}>
                    {otherLabel}
                  </button>
                ) : (
                  <span className="font-medium text-tan">{otherLabel}</span>
                )}
              </div>
              {e.s && e.s.length > 0 && (
                <p className="mono text-[10px] text-tan-3">
                  defined in:{" "}
                  {e.s.map((docNo, j) => (
                    <span key={docNo}>
                      {j > 0 && ", "}
                      <button onClick={() => onNavDoc("relation_source", docNo)} className="hover:underline text-accent">
                        {docNo}
                      </button>
                    </span>
                  ))}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
