import type { ReactElement } from "react";
import type { RowComponentProps } from "react-window";
import { CollapsibleNode } from "./CollapsibleNode";
import type { FlatEntry } from "./CollapsibleNode";

export type AtlasRowData = {
  flatNodes: FlatEntry[];
  selectedId: string;
  autoExpanded: Set<string>;
  userToggles: Set<string>;
  onNavigate: (id: string) => void;
  onToggle: (id: string) => void;
};

export function AtlasRow({
  index,
  style,
  ariaAttributes,
  flatNodes,
  selectedId,
  autoExpanded,
  userToggles,
  onNavigate,
  onToggle,
}: RowComponentProps<AtlasRowData>): ReactElement | null {
  const entry = flatNodes[index];
  if (!entry) return null;
  const nodeId = entry.node.id;
  const isExpanded = autoExpanded.has(nodeId) !== userToggles.has(nodeId);

  return (
    <div style={style} {...ariaAttributes}>
      <div className="max-w-2xl mx-auto px-1">
        <CollapsibleNode
          entry={entry}
          isSelected={nodeId === selectedId}
          isExpanded={isExpanded}
          onNavigate={onNavigate}
          onToggle={onToggle}
        />
      </div>
    </div>
  );
}
