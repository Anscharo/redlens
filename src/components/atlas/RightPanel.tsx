import { useCallback, useMemo } from "react";
import type { AtlasNode, AddressInfo } from "../../types";
import type { ChainValue } from "../../lib/chainstate";
import type { EdgeResult } from "../../lib/graph";
import type { CousinDoc } from "../../lib/cousins";
import type { GlossaryEntry } from "../../lib/glossary";
import { RelatedNode } from "../RelatedNode";
import { AddressCard } from "../AddressCard";
import { NodeHistory } from "../history/NodeHistory";
import { PreviewHistory } from "../history/PreviewHistory";
import { ErrorBoundary, InlineError } from "../ErrorBoundary";
import { useDataSource } from "../../lib/dataSource";
import { track } from "../../lib/analytics";

type RightTab = "annotations" | "glossary" | "history";

const HIDE = new Set(["parent_of", "mentions", "proxies_to", "cites"]);

const SECTION_HEAD = "text-sm mono text-tan-2 font-semibold tracking-wide";

export function RightPanel({
  id,
  linkedNodes,
  cousinDocs,
  targetAddresses,
  chainValues,
  annotationCount,
  graphEdges,
  glossaryTerms,
  onNavigate,
  onNavigateByDocNo,
  tab,
  onTabChange,
}: {
  id: string;
  linkedNodes: AtlasNode[];
  cousinDocs: CousinDoc[];
  targetAddresses: Record<string, AddressInfo>;
  chainValues: Record<string, Record<string, ChainValue>>;
  annotationCount: number;
  graphEdges: EdgeResult;
  glossaryTerms: GlossaryEntry[][];
  onNavigate: (id: string) => void;
  onNavigateByDocNo: (docNo: string) => void;
  tab: RightTab;
  onTabChange: (t: RightTab) => void;
}) {
  const { preview } = useDataSource();

  // Navigation from the annotations/glossary panel, tagged with what was clicked.
  const annNav = useCallback(
    (kind: string, nid: string) => {
      track("reader_annotation_nav", { kind, node_id: nid });
      onNavigate(nid);
    },
    [onNavigate],
  );
  const navLinked = useCallback((nid: string) => annNav("linked_doc", nid), [annNav]);
  const navCousin = useCallback((nid: string) => annNav("cousin_doc", nid), [annNav]);
  const annNavDoc = useCallback(
    (kind: string, docNo: string) => {
      track("reader_annotation_nav", { kind, doc_no: docNo });
      onNavigateByDocNo(docNo);
    },
    [onNavigateByDocNo],
  );

  // Tag each relation with its direction once (instead of an O(n²) includes
  // scan in render) and memoize so a tab switch doesn't refilter the edges.
  const { citedBy, graphRels } = useMemo(() => {
    const out = graphEdges.outbound
      .filter((e) => !HIDE.has(e.e))
      .map((edge) => ({ edge, isOut: true }));
    const inb = graphEdges.inbound
      .filter((e) => !HIDE.has(e.e))
      .map((edge) => ({ edge, isOut: false }));
    return {
      citedBy: graphEdges.inbound.filter((e) => e.e === "cites"),
      graphRels: [...out, ...inb],
    };
  }, [graphEdges]);
  const isSelfNav = (e: EdgeResult["outbound"][number], isOut: boolean) => {
    const did = isOut ? e.to_did : e.from_did;
    return did === id || (isOut ? e.t : e.f) === id;
  };

  return (
    <>
      <div
        className="flex gap-1 border-b shrink-0"
        style={{ borderColor: "var(--border)", padding: "8px 16px 0" }}
        role="tablist"
      >
        <button
          role="tab"
          aria-selected={tab === "annotations"}
          onClick={() => onTabChange("annotations")}
          className="right-tab"
        >
          annotations{annotationCount > 0 && <span style={{ marginLeft: 4 }}>· {annotationCount}</span>}
        </button>
        <button
          role="tab"
          aria-selected={tab === "glossary"}
          onClick={() => onTabChange("glossary")}
          className="right-tab"
        >
          glossary{glossaryTerms.length > 0 && <span style={{ marginLeft: 4 }}>· {glossaryTerms.length}</span>}
        </button>
        <button
          role="tab"
          aria-selected={tab === "history"}
          onClick={() => onTabChange("history")}
          className="right-tab"
        >
          history
        </button>
      </div>

      <div className="overflow-y-auto flex-1">
        {tab === "annotations" ? (
          <div className="px-4 py-5"> 
            {linkedNodes.length > 0 ? (
              <section>
                <p className={`${SECTION_HEAD} mb-4`}>
                  linked documents · {linkedNodes.length}
                </p>
                {linkedNodes.map((node) => (
                  <RelatedNode key={node.id} node={node} onNavigate={navLinked} />
                ))}
              </section>
            ) : null}

            {cousinDocs.length > 0 ? (
              <section className="mt-8 pt-5 border-t border-border">
                <p className={`${SECTION_HEAD} mb-2`}>
                  cousin documents · {cousinDocs.length}
                </p>
                <p className="text-xs leading-relaxed mb-4 text-tan-3">
                  Equivalent documents under the other Prime Agents.
                </p>
                <div className="flex flex-col gap-4">
                  {cousinDocs.map(({ node, agent }) => (
                    <div key={node.id} style={{ padding: 4 }}>
                      <RelatedNode
                        node={node}
                        eyebrow={`${agent} agent`}
                        onNavigate={navCousin}
                      />
                    </div>
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
                      className="w-full text-left px-2 py-1.5 rounded text-xs mono hover:bg-hover transition-colors text-tan-2"
                      onClick={() => annNav("cited_by", e.f)}
                    >
                      {e.s?.[0] ?? e.f.slice(0, 8)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {graphRels.length > 0 && (
              <div className="mt-8">
                <p className={`${SECTION_HEAD} mb-3`}>relations · {graphRels.length}</p>
                <div className="space-y-2">
                  {graphRels.filter(({ edge, isOut }) => !isSelfNav(edge, isOut)).map(({ edge: e, isOut }, i) => {
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
                          <span className="mono px-1.5 py-0.5 rounded text-[10px] bg-surface text-accent">
                            {e.e}
                          </span>
                          {!isOut && <span className="text-[10px] mono text-gray">←</span>}
                          {otherNavId ? (
                            <button
                              className="mono hover:underline text-left text-tan-2"
                              onClick={() => annNav("relation", otherNavId)}
                            >
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
                                <button
                                  onClick={() => annNavDoc("relation_source", docNo)}
                                  className="hover:underline text-accent"
                                >
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
            )}

            {Object.keys(targetAddresses).length > 0 && (
              <div className="mt-8">
                <p className={`${SECTION_HEAD} mb-4`}>
                  addresses · {Object.keys(targetAddresses).length}
                </p>
                {Object.entries(targetAddresses).map(([address, info]) => (
                  <ErrorBoundary key={address} fallback={(error) => <InlineError error={error} />}>
                    <AddressCard
                      address={address}
                      info={info}
                      chainValues={chainValues[address]}
                    />
                  </ErrorBoundary>
                ))}
              </div>
            )}

          </div>
        ) : tab === "glossary" ? (
          <div className="px-4 py-5">
            {glossaryTerms.length === 0 ? (
              <p className="text-xs mono text-tan-3">No glossary terms in this section.</p>
            ) : (
              <div className="space-y-4">
                {glossaryTerms.map((entries) => (
                  <div key={entries[0].nodeId} className="border-b border-border pb-4">
                    <button
                      onClick={() => annNav("glossary", entries[0].nodeId)}
                      className="text-xs font-semibold mono mb-1 text-accent hover:underline cursor-pointer text-left"
                    >
                      {entries[0].term}
                    </button>
                    {entries.map((e, i) => (
                      <div key={i} className={i > 0 ? "mt-2 pt-2 border-t border-border" : ""}>
                        {entries.length > 1 && e.sourceContext && (
                          <button
                            onClick={() => annNav("glossary_source", e.nodeId)}
                            className="text-[10px] mono mb-0.5 text-tan-3 hover:text-accent cursor-pointer text-left block"
                          >
                            {e.sourceContext}
                          </button>
                        )}
                        <p className="text-xs leading-relaxed text-tan-2">{e.content}</p>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="px-4 py-5">
            <ErrorBoundary resetKey={id} fallback={(error) => <InlineError error={error} />}>
              {preview ? <PreviewHistory nodeId={id} /> : <NodeHistory nodeId={id} />}
            </ErrorBoundary>
          </div>
        )}
      </div>
    </>
  );
}
