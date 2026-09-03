import { useCallback, useEffect, useMemo, useRef } from "react";
import type { AtlasNode, AddressInfo } from "@/types";
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
import { glide } from "../../lib/animatedScroll";
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
  byNameOnly,
  annotationCount,
  graphEdges,
  glossaryTerms,
  onNavigate,
  onNavigateByDocNo,
  tab,
  onTabChange,
  selectable,
  byParent,
}: {
  id: string;
  linkedNodes: AtlasNode[];
  cousinDocs: CousinDoc[];
  targetAddresses: Record<string, AddressInfo>;
  chainValues: Record<string, Record<string, ChainValue>>;
  /** Addresses this section named only by chainlog key, not a 0x literal. */
  byNameOnly?: Set<string>;
  annotationCount: number;
  graphEdges: EdgeResult;
  glossaryTerms: GlossaryEntry[][];
  onNavigate: (id: string) => void;
  onNavigateByDocNo: (docNo: string) => void;
  /** The section the pill bar highlights and the scroll area jumps to. Driven by
   *  the URL's ?view= exactly as the old tabs were. */
  tab: RightTab;
  onTabChange: (t: RightTab) => void;
  /** Show self-subscribing selection checkboxes on related cards. The checkbox
   *  state lives in each card's RelatedSelectBox, so a selection toggle doesn't
   *  re-render this panel (or the sibling reader) — only the checkbox itself. */
  selectable?: boolean;
  byParent?: Map<string | null, AtlasNode[]>;
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
  // scan in render) and memoize so a re-render doesn't refilter the edges.
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
  const shownRels = graphRels.filter(({ edge, isOut }) => !isSelfNav(edge, isOut));

  // All three sections now live in one scroll area; the pill bar jumps to them.
  // An empty annotations block collapses so the first thing on screen is whatever
  // section actually has content (history when a doc has no annotations).
  const hasAnnotations =
    linkedNodes.length > 0 ||
    cousinDocs.length > 0 ||
    citedBy.length > 0 ||
    graphRels.length > 0 || // the relations header counts raw edges, even if every row self-nav-filters out
    Object.keys(targetAddresses).length > 0;

  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<RightTab, HTMLElement | null>>({
    annotations: null,
    history: null,
    glossary: null,
  });
  // Align the selected section to the top of the scroll area. Instant on the
  // first render — a deep-linked ?view= shouldn't animate on load — then a glide
  // on later pill clicks and doc changes.
  const scrollToSection = useCallback((view: RightTab, animate: boolean) => {
    const container = scrollRef.current;
    const section = sectionRefs.current[view];
    if (!container || !section) return;
    const delta = section.getBoundingClientRect().top - container.getBoundingClientRect().top;
    const target = Math.max(0, container.scrollTop + delta);
    if (animate) glide(container, target);
    else container.scrollTop = target;
  }, []);
  const mounted = useRef(false);
  useEffect(() => {
    scrollToSection(tab, mounted.current);
    mounted.current = true;
  }, [tab, id, scrollToSection]);

  return (
    <>
      <div
        className="flex gap-1 border-b shrink-0"
        style={{ borderColor: "var(--border)", padding: "8px 16px 0" }}
        role="tablist"
      >
        <button role="tab" aria-selected={tab === "annotations"} onClick={() => onTabChange("annotations")} className="right-tab">
          annotations{annotationCount > 0 && <span style={{ marginLeft: 4 }}>· {annotationCount}</span>}
        </button>
        <button role="tab" aria-selected={tab === "history"} onClick={() => onTabChange("history")} className="right-tab">
          history
        </button>
        <button role="tab" aria-selected={tab === "glossary"} onClick={() => onTabChange("glossary")} className="right-tab">
          glossary{glossaryTerms.length > 0 && <span style={{ marginLeft: 4 }}>· {glossaryTerms.length}</span>}
        </button>
      </div>

      <div className="overflow-y-auto flex-1" ref={scrollRef}>
        <div className="px-4 py-5">
          {hasAnnotations && (
            <section ref={(el) => { sectionRefs.current.annotations = el; }}>
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
                    {shownRels.map(({ edge: e, isOut }, i) => {
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
                              <button className="mono hover:underline text-left text-tan-2" onClick={() => annNav("relation", otherNavId)}>
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
                                  <button onClick={() => annNavDoc("relation_source", docNo)} className="hover:underline text-accent">
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
                  <p className={`${SECTION_HEAD} mb-4`}>addresses · {Object.keys(targetAddresses).length}</p>
                  {Object.entries(targetAddresses).map(([address, info]) => (
                    <ErrorBoundary key={address} fallback={(error) => <InlineError error={error} />}>
                      <AddressCard address={address} info={info} chainValues={chainValues[address]} byName={byNameOnly?.has(address)} />
                    </ErrorBoundary>
                  ))}
                </div>
              )}
            </section>
          )}

          <section
            ref={(el) => { sectionRefs.current.history = el; }}
            className={hasAnnotations ? "mt-8 pt-5 border-t border-border" : ""}
            data-testid="history-panel"
          >
            <p className={`${SECTION_HEAD} mb-3`}>history</p>
            <ErrorBoundary resetKey={id} fallback={(error) => <InlineError error={error} />}>
              {preview ? <PreviewHistory nodeId={id} /> : <NodeHistory nodeId={id} />}
            </ErrorBoundary>
          </section>

          <section ref={(el) => { sectionRefs.current.glossary = el; }} className="mt-8 pt-5 border-t border-border">
            <p className={`${SECTION_HEAD} mb-3`}>glossary</p>
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
          </section>
        </div>
      </div>
    </>
  );
}
