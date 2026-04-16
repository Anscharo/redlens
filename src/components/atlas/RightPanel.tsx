import type { AtlasNode, AddressInfo } from "../../types";
import type { ChainValue } from "../../lib/chainstate";
import type { EdgeResult } from "../../lib/graph";
import { RelatedNode } from "../RelatedNode";
import { AddressCard } from "../AddressCard";
import { NodeHistory } from "../history/NodeHistory";

export type RightTab = "annotations" | "history";

const HIDE = new Set(["parent_of", "mentions", "proxies_to", "cites"]);

export function RightPanel({
  id,
  linkedNodes,
  targetAddresses,
  chainValues,
  annotationCount,
  graphEdges,
  onNavigate,
  tab,
  onTabChange,
}: {
  id: string;
  linkedNodes: AtlasNode[];
  targetAddresses: Record<string, AddressInfo>;
  chainValues: Record<string, Record<string, ChainValue>>;
  annotationCount: number;
  graphEdges: EdgeResult;
  onNavigate: (id: string) => void;
  tab: RightTab;
  onTabChange: (t: RightTab) => void;
}) {
  const citedBy = graphEdges.inbound.filter(e => e.e === "cites");
  const outRels = graphEdges.outbound.filter(e => !HIDE.has(e.e));
  const inRels  = graphEdges.inbound.filter(e => !HIDE.has(e.e));
  const graphRels = [...outRels, ...inRels];

  return (
    <>
      <div className="shrink-0 flex border-b border-border" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "annotations"}
          onClick={() => onTabChange("annotations")}
          className="right-tab"
        >
          annotations{annotationCount > 0 ? ` · ${annotationCount}` : ""}
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

            {/* Existing: inline UUID-linked nodes */}
            {linkedNodes.length > 0 ? (
              <>
                <p className="text-xs mono mb-4 text-tan-3">
                  {linkedNodes.length} linked documents{linkedNodes.length !== 1 ? "s" : ""}
                </p>
                {linkedNodes.map(node => (
                  <RelatedNode key={node.id} node={node} onNavigate={onNavigate} />
                ))}
              </>
            ) : (
              <p className="text-xs mono text-tan-3">doesn't explicitly link to any documents</p>
            )}

            {/* Graph: inbound citations (backlinks) */}
            {citedBy.length > 0 && (
              <div className="mt-8">
                <p className="text-xs mono mb-3 text-tan-3">cited by · {citedBy.length}</p>
                <div className="space-y-1">
                  {citedBy.map((e, i) => (
                    <button
                      key={i}
                      className="w-full text-left px-2 py-1.5 rounded text-xs mono hover:bg-hover transition-colors text-tan-2"
                      onClick={() => onNavigate(e.f)}
                    >
                      {e.s?.[0] ?? e.f.slice(0, 8)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Graph: structural/semantic relations */}
            {graphRels.length > 0 && (
              <div className="mt-8">
                <p className="text-xs mono mb-3 text-tan-3">relations · {graphRels.length}</p>
                <div className="space-y-2">
                  {graphRels.map((e, i) => {
                    const isOut = outRels.includes(e);
                    const otherId   = isOut ? e.t  : e.f;
                    const otherType = isOut ? e.tt : e.ft;
                    const otherLabel = isOut
                      ? (e.to_label   ?? otherId.slice(0, 8))
                      : (e.from_label ?? otherId.slice(0, 8));
                    return (
                      <div key={i} className="text-xs pb-2 border-b border-border">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="mono px-1.5 py-0.5 rounded text-[10px] bg-surface text-accent">
                            {e.e}
                          </span>
                          {!isOut && <span className="text-[10px] mono text-gray">←</span>}
                          {otherType === "doc" ? (
                            <button
                              className="mono hover:underline text-left text-tan-2"
                              onClick={() => onNavigate(otherId)}
                            >
                              {otherLabel}
                            </button>
                          ) : (
                            <span className="font-medium text-tan">{otherLabel}</span>
                          )}
                        </div>
                        {e.s && e.s.length > 0 && (
                          <p className="mono text-[10px] text-tan-3">
                            source: {e.s.join(", ")}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Existing: address cards */}
            {Object.keys(targetAddresses).length > 0 && (
              <div className="mt-8">
                <p className="text-xs mono mb-4 text-tan-3">
                  addresses · {Object.keys(targetAddresses).length}
                </p>
                {Object.entries(targetAddresses).map(([address, info]) => (
                  <AddressCard key={address} address={address} info={info} chainValues={chainValues[address]} />
                ))}
              </div>
            )}

          </div>
        ) : (
          <div className="px-4 py-5">
            <NodeHistory nodeId={id} />
          </div>
        )}
      </div>
    </>
  );
}
