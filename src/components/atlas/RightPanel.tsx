import type { AtlasNode, AddressInfo } from "../../types";
import type { ChainValue } from "../../lib/chainstate";
import { RelatedNode } from "../RelatedNode";
import { AddressCard } from "../AddressCard";
import { NodeHistory } from "../history/NodeHistory";

export type RightTab = "annotations" | "history";

export function RightPanel({
  id,
  linkedNodes,
  targetAddresses,
  chainValues,
  annotationCount,
  onNavigate,
  tab,
  onTabChange,
}: {
  id: string;
  linkedNodes: AtlasNode[];
  targetAddresses: Record<string, AddressInfo>;
  chainValues: Record<string, Record<string, ChainValue>>;
  annotationCount: number;
  onNavigate: (id: string) => void;
  tab: RightTab;
  onTabChange: (t: RightTab) => void;
}) {
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
            {linkedNodes.length > 0 ? (
              <>
                <p className="text-xs mono mb-4 text-tan-3">
                  {linkedNodes.length} linked node{linkedNodes.length !== 1 ? "s" : ""}
                </p>
                {linkedNodes.map(node => (
                  <RelatedNode key={node.id} node={node} onNavigate={onNavigate} />
                ))}
              </>
            ) : (
              <p className="text-xs mono text-tan-3">no linked nodes</p>
            )}
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
