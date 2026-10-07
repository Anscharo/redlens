import type { CSSProperties } from "react";
import { AtlasReader } from "./AtlasReader";
import { AtlasAnnotations } from "./AtlasAnnotations";
import type { LoadedData } from "@/lib/atlasHelpers";
import type { useNodeAnnotations } from "../../hooks/useNodeAnnotations";
import type { AtlasTab } from "../../lib/atlasTab";

interface AtlasReaderRowProps {
  id: string;
  data: LoadedData;
  annotations: ReturnType<typeof useNodeAnnotations>;
  view: AtlasTab;
  onViewChange: (v: AtlasTab) => void;
  onNavigate: (id: string) => void;
  selectable: boolean;
  selectedId: string | null;
  splitId: string | null;
  onSplitChange: (id: string | null) => void;
  agentByDoc: Map<string, string> | null;
}

const ATLAS_GRID_STYLE: CSSProperties = { minHeight: 0, overflow: "hidden" };

function countAnnotations(a: AtlasReaderRowProps["annotations"]): number {
  return a.annotationDocs.length + a.linkedNodes.length + a.cousinDocs.length + Object.keys(a.targetAddresses).length;
}

// The reader column beside the annotations panel for the selected doc.
export function AtlasReaderRow(props: AtlasReaderRowProps) {
  const { id, data, annotations, view, onViewChange, onNavigate, selectable, ...reader } = props;
  const navigateByDocNo = (docNo: string) => {
    const uuid = data.atlas.docNoToId.get(docNo);
    if (uuid) onNavigate(uuid);
  };
  return (
    <div id="atlas-reader-row" className="flex-1 flex" style={ATLAS_GRID_STYLE}>
      <AtlasReader id={id} data={data} {...reader} />
      {id && (
        <AtlasAnnotations
          id={id}
          {...annotations}
          annotationCount={countAnnotations(annotations)}
          tab={view}
          onTabChange={onViewChange}
          onNavigate={onNavigate}
          onNavigateByDocNo={navigateByDocNo}
          selectable={selectable}
          byParent={data.atlas.byParent}
        />
      )}
    </div>
  );
}
